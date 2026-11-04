-- Data de nascimento do atleta (para o cartão de aniversário) e no pré-cadastro.

alter table public.athletes
  add column birth_date date check (birth_date is null or birth_date between date '1900-01-01' and date '2100-01-01');
alter table public.signup_requests
  add column birth_date date check (birth_date is null or birth_date between date '1900-01-01' and date '2100-01-01');

-- Converte 'AAAA-MM-DD' em data sem derrubar o cadastro quando o texto for inválido (ex.: 2023-02-31).
create function public.safe_date(p text) returns date
language plpgsql immutable as $$
declare d date;
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  d := p::date;
  if d between date '1900-01-01' and current_date then return d; end if;
  return null;
exception when others then return null;
end $$;

create or replace function public.handle_signup_form() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); nm text;
begin
  if coalesce(m->>'signup_form', '') <> 'true' then return new; end if;
  nm := left(trim(coalesce(m->>'full_name', '')), 120);
  insert into public.signup_requests (user_id, email, full_name, nickname, phone, whatsapp_consent, birth_date)
  values (new.id, new.email,
          case when nm = '' then new.email else nm end,
          nullif(left(trim(coalesce(m->>'nickname', '')), 60), ''),
          nullif(left(regexp_replace(coalesce(m->>'phone', ''), '\D', '', 'g'), 15), ''),
          coalesce(m->>'whatsapp_consent', '') = 'true',
          public.safe_date(m->>'birth_date'))
  on conflict (user_id) do nothing;
  return new;
end $$;

create or replace function public.approve_signup(p_request uuid, p_athlete uuid default null) returns uuid
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
    insert into public.athletes (full_name, nickname, phone, email, whatsapp_consent, birth_date)
    values (r.full_name, r.nickname, r.phone, r.email, r.whatsapp_consent, r.birth_date)
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
      birth_date = coalesce(birth_date, r.birth_date),
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
