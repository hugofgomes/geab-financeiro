-- Cadastro de novo grupo: nome completo e telefone (WhatsApp) passam a ser obrigatórios e o contato já nasce no painel do SaaS.
-- Reversão: recriar handle_signup_form (0017) e create_my_org (0031) e remover o telefone obrigatório.

-- Novo grupo pelo formulário: exige nome completo e telefone com DDD; grava o responsável (nome, e-mail, telefone) em org_internal.
create or replace function public.handle_signup_form() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); nm text; tn uuid; oslug text; oname text; ph text;
begin
  nm := left(trim(coalesce(m->>'full_name', '')), 120);

  -- Novo grupo: quem se cadastra vira a Diretoria do grupo (teste gratuito do plano). Slug inválido/ocupado: não cria nada.
  oslug := lower(trim(coalesce(m->>'new_org_slug', '')));
  if oslug <> '' then
    oname := left(trim(coalesce(m->>'new_org_name', '')), 80);
    if oname <> '' and public.slug_available(oslug) then
      ph := left(regexp_replace(coalesce(m->>'phone', ''), '\D', '', 'g'), 15);
      if length(nm) < 3 then raise exception 'Informe o nome completo'; end if;
      if length(ph) < 12 then raise exception 'Informe o telefone com DDD'; end if;
      insert into public.organizations (slug, name, status) values (oslug, oname, 'teste') returning id into tn;
      insert into public.profiles (tenant_id, id, full_name, role) values (tn, new.id, nm, 'admin');
      insert into public.org_internal (org_id, contact_name, contact_email, contact_phone) values (tn, nm, lower(new.email), ph)
        on conflict (org_id) do update set contact_name = excluded.contact_name, contact_email = excluded.contact_email, contact_phone = excluded.contact_phone;
      insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
        values (tn, new.id, 'CREATE_ORGANIZATION', 'organizations', tn::text, jsonb_build_object('slug', oslug));
    end if;
    return new;
  end if;

  if coalesce(m->>'signup_form', '') <> 'true' then return new; end if;
  tn := coalesce((select id from public.organizations where slug = m->>'tenant_slug' and status in ('teste', 'ativa')),
                 case when coalesce(m->>'tenant_slug', '') = '' then public.default_tenant() end);
  if tn is null then return new; end if;
  insert into public.signup_requests (tenant_id, user_id, email, full_name, nickname, phone, whatsapp_consent, birth_date)
  values (tn, new.id, new.email,
          case when nm = '' then new.email else nm end,
          nullif(left(trim(coalesce(m->>'nickname', '')), 60), ''),
          nullif(left(regexp_replace(coalesce(m->>'phone', ''), '\D', '', 'g'), 15), ''),
          coalesce(m->>'whatsapp_consent', '') = 'true',
          public.safe_date(m->>'birth_date'))
  on conflict (user_id) do nothing;
  return new;
end $$;

-- Criar o próprio grupo depois (conta sem grupo): telefone obrigatório (informado agora ou já presente no cadastro).
drop function public.create_my_org(text, text);
create function public.create_my_org(p_name text, p_slug text, p_phone text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare u auth.users%rowtype; s text := lower(trim(coalesce(p_slug, ''))); oid uuid; nm text; ph text;
begin
  if auth.uid() is null then raise exception 'Entre para continuar'; end if;
  select * into u from auth.users where id = auth.uid();
  if u.email_confirmed_at is null then raise exception 'Confirme o seu e-mail antes de criar o grupo'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'Sua conta já pertence a um grupo'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Informe o nome do grupo'; end if;
  if not public.slug_available(s) then raise exception 'Endereço indisponível ou inválido'; end if;
  ph := left(regexp_replace(coalesce(nullif(p_phone, ''), u.raw_user_meta_data->>'phone', ''), '\D', '', 'g'), 15);
  if length(ph) < 10 then raise exception 'Informe o telefone com DDD'; end if;
  if length(ph) <= 11 then ph := '55' || ph; end if;
  insert into public.organizations (slug, name, status) values (s, left(trim(p_name), 80), 'teste') returning id into oid;
  nm := left(trim(coalesce(u.raw_user_meta_data->>'full_name', '')), 120);
  insert into public.profiles (tenant_id, id, full_name, role) values (oid, auth.uid(), coalesce(nullif(nm, ''), u.email), 'admin');
  insert into public.org_internal (org_id, contact_name, contact_email, contact_phone) values (oid, coalesce(nullif(nm, ''), u.email), lower(u.email), ph)
    on conflict (org_id) do update set contact_name = excluded.contact_name, contact_email = excluded.contact_email, contact_phone = excluded.contact_phone;
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
    values (oid, auth.uid(), 'CREATE_ORGANIZATION', 'organizations', oid::text, jsonb_build_object('slug', s, 'origem', 'cadastro_sem_grupo'));
  return oid;
end $$;
revoke execute on function public.create_my_org(text, text, text) from public, anon;
grant execute on function public.create_my_org(text, text, text) to authenticated;
