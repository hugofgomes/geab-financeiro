-- Cadastro sem grupo: quem criou conta pelo endereço principal (sem indicar grupo) ficava sem perfil e sem solicitação.
-- Agora essa pessoa, já logada e com e-mail confirmado, escolhe: criar o próprio grupo (teste gratuito do plano) ou pedir entrada num grupo.
-- Só funções novas. Reversão: drop function public.public_trial_days(), public.create_my_org(text, text), public.request_join_group(text);

-- Dias de teste grátis oferecidos hoje (vêm do plano de teste; o site mostra este número).
create function public.public_trial_days() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select trial_days from public.plans where code = 'teste'), 10)
$$;

-- Cria o grupo da própria pessoa (ela vira Administradora) com o teste gratuito.
create function public.create_my_org(p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u auth.users%rowtype; s text := lower(trim(coalesce(p_slug, ''))); oid uuid; nm text;
begin
  if auth.uid() is null then raise exception 'Entre para continuar'; end if;
  select * into u from auth.users where id = auth.uid();
  if u.email_confirmed_at is null then raise exception 'Confirme o seu e-mail antes de criar o grupo'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'Sua conta já pertence a um grupo'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Informe o nome do grupo'; end if;
  if not public.slug_available(s) then raise exception 'Endereço indisponível ou inválido'; end if;
  insert into public.organizations (slug, name, status) values (s, left(trim(p_name), 80), 'teste') returning id into oid;   -- plano e fim do teste vêm dos gatilhos
  nm := left(trim(coalesce(u.raw_user_meta_data->>'full_name', '')), 120);
  insert into public.profiles (tenant_id, id, full_name, role) values (oid, auth.uid(), coalesce(nullif(nm, ''), u.email), 'admin');
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
    values (oid, auth.uid(), 'CREATE_ORGANIZATION', 'organizations', oid::text, jsonb_build_object('slug', s, 'origem', 'cadastro_sem_grupo'));
  return oid;
end $$;

-- Pede entrada num grupo existente (a Diretoria do grupo aprova), com os dados que a pessoa já informou no cadastro.
create function public.request_join_group(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare u auth.users%rowtype; m jsonb; tn uuid; nm text;
begin
  if auth.uid() is null then raise exception 'Entre para continuar'; end if;
  select * into u from auth.users where id = auth.uid();
  m := coalesce(u.raw_user_meta_data, '{}'::jsonb);
  if exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'Sua conta já pertence a um grupo'; end if;
  select id into tn from public.organizations where slug = lower(trim(coalesce(p_slug, ''))) and status in ('teste', 'ativa');
  if tn is null then raise exception 'Grupo não encontrado. Confira o endereço com a administração'; end if;
  nm := left(trim(coalesce(m->>'full_name', '')), 120);
  insert into public.signup_requests (tenant_id, user_id, email, full_name, nickname, phone, whatsapp_consent, birth_date)
  values (tn, u.id, u.email, case when nm = '' then u.email else nm end,
          nullif(left(trim(coalesce(m->>'nickname', '')), 60), ''),
          nullif(left(regexp_replace(coalesce(m->>'phone', ''), '\D', '', 'g'), 15), ''),
          coalesce(m->>'whatsapp_consent', '') = 'true', public.safe_date(m->>'birth_date'))
  on conflict (user_id) do nothing;
end $$;

revoke execute on function public.create_my_org(text, text), public.request_join_group(text) from public, anon;
grant execute on function public.create_my_org(text, text), public.request_join_group(text) to authenticated;
grant execute on function public.public_trial_days() to anon, authenticated;
