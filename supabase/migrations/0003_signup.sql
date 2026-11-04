-- Pré-cadastro público de atletas, com confirmação de e-mail (feita pelo Supabase Auth) e aprovação do admin.
-- Quem se cadastra NÃO ganha acesso a nada: só passa a ter perfil quando o admin aprova.

create type public.signup_status as enum ('pendente', 'aprovado', 'recusado');

create table public.signup_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  nickname text,
  phone text,                                    -- só dígitos com DDI
  whatsapp_consent boolean not null default false,
  status public.signup_status not null default 'pendente',
  athlete_id uuid references public.athletes(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
alter table public.signup_requests enable row level security;
create policy signup_admin on public.signup_requests for all using (public.is_admin()) with check (public.is_admin());
create policy signup_self on public.signup_requests for select using (user_id = auth.uid());
create index on public.signup_requests (status, created_at);

-- Cria a solicitação quando o formulário público cria o usuário (metadado signup_form = true).
-- Usuários criados pelo painel do Supabase ou por outros meios não geram solicitação.
create function public.handle_signup_form() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); nm text;
begin
  if coalesce(m->>'signup_form', '') <> 'true' then return new; end if;
  nm := left(trim(coalesce(m->>'full_name', '')), 120);
  insert into public.signup_requests (user_id, email, full_name, nickname, phone, whatsapp_consent)
  values (new.id, new.email,
          case when nm = '' then new.email else nm end,
          nullif(left(trim(coalesce(m->>'nickname', '')), 60), ''),
          nullif(left(regexp_replace(coalesce(m->>'phone', ''), '\D', '', 'g'), 15), ''),
          coalesce(m->>'whatsapp_consent', '') = 'true')
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_signup_form after insert on auth.users
  for each row execute function public.handle_signup_form();

-- Aprova: cria o atleta (ou vincula a um existente, ex.: vindo da planilha) e libera o acesso ao portal.
create function public.approve_signup(p_request uuid, p_athlete uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.signup_requests; aid uuid;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  select * into r from public.signup_requests where id = p_request for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if r.status <> 'pendente' then raise exception 'Esta solicitação já foi decidida'; end if;
  if exists (select 1 from public.profiles where id = r.user_id) then
    raise exception 'Este usuário já possui perfil de acesso';
  end if;

  if p_athlete is null then
    insert into public.athletes (full_name, nickname, phone, email, whatsapp_consent)
    values (r.full_name, r.nickname, r.phone, r.email, r.whatsapp_consent)
    returning id into aid;
  else
    aid := p_athlete;
    if not exists (select 1 from public.athletes where id = aid) then raise exception 'Atleta não encontrado'; end if;
    if exists (select 1 from public.profiles where athlete_id = aid) then
      raise exception 'Este atleta já tem um acesso vinculado a outro usuário';
    end if;
    update public.athletes set
      phone = coalesce(nullif(phone, ''), r.phone),
      email = coalesce(nullif(email, ''), r.email),
      whatsapp_consent = whatsapp_consent or r.whatsapp_consent
    where id = aid;
  end if;

  insert into public.profiles (id, full_name, role, athlete_id, active)
  values (r.user_id, r.full_name, 'atleta', aid, true);

  update public.signup_requests set status = 'aprovado', athlete_id = aid, decided_at = now(), decided_by = auth.uid()
  where id = r.id;
  insert into public.audit_log (user_id, action, entity, entity_id, detail)
  values (auth.uid(), 'APPROVE_SIGNUP', 'signup_requests', r.id::text, jsonb_build_object('athlete_id', aid, 'email', r.email));
  return aid;
end $$;

create function public.reject_signup(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.signup_requests;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  select * into r from public.signup_requests where id = p_request for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if r.status <> 'pendente' then raise exception 'Esta solicitação já foi decidida'; end if;
  update public.signup_requests set status = 'recusado', decided_at = now(), decided_by = auth.uid() where id = r.id;
  insert into public.audit_log (user_id, action, entity, entity_id, detail)
  values (auth.uid(), 'REJECT_SIGNUP', 'signup_requests', r.id::text, jsonb_build_object('email', r.email));
end $$;

revoke execute on function public.approve_signup(uuid, uuid) from public, anon;
revoke execute on function public.reject_signup(uuid) from public, anon;
grant execute on function public.approve_signup(uuid, uuid) to authenticated;
grant execute on function public.reject_signup(uuid) to authenticated;
