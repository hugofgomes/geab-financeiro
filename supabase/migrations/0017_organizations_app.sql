-- Etapa 2 do SaaS: identidade do grupo, criação de novos grupos, suspensão e consulta pública (login/cadastro).

alter table public.organizations
  add column website text check (website is null or length(website) <= 120),
  add column tagline text check (tagline is null or length(tagline) <= 80),
  add column trial_ends_at timestamptz;      -- fim do teste gratuito (cobrança vem na etapa de assinaturas)
update public.organizations
   set website = 'geabfutebol.com.br', tagline = 'Tradição, amizade e futebol', status = 'ativa'
 where slug = 'geab';

-- Grupo suspenso ou cancelado perde o acesso: sem organização efetiva, nenhuma política libera linha alguma.
create or replace function public.current_tenant() returns uuid
language sql stable security definer set search_path = public as $$
  select p.tenant_id from public.profiles p join public.organizations o on o.id = p.tenant_id
  where p.id = auth.uid() and p.active and o.status in ('teste', 'ativa')
$$;

-- ───────── Endereço (slug) ─────────
create function public.slug_reserved(p text) returns boolean language sql immutable as $$
  select p = any (array['www','app','api','admin','painel','login','cadastro','novo','novo-grupo','suporte','mail','email','static',
                        'assets','cdn','dashboard','status','docs','blog','ajuda','plataforma','superadmin','super-admin','teste','test','demo'])
$$;

create function public.slug_available(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' and not public.slug_reserved(p_slug)
                  and not exists (select 1 from public.organizations where slug = p_slug), false)
$$;

-- Identidade pública do grupo (tela de login e cadastro, antes de entrar). Sem slug: a única organização, se houver só uma.
create function public.org_public(p_slug text default null)
returns table (slug text, name text, logo_url text, primary_color text, website text, tagline text)
language sql stable security definer set search_path = public as $$
  select o.slug, o.name, o.logo_url, o.primary_color, o.website, o.tagline from public.organizations o
  where o.status in ('teste', 'ativa')
    and (o.slug = p_slug or (p_slug is null and o.id = public.default_tenant()))
$$;

-- ───────── Criar grupo no cadastro: metadados new_org_slug / new_org_name do formulário público ─────────
create or replace function public.handle_signup_form() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); nm text; tn uuid; oslug text; oname text;
begin
  nm := left(trim(coalesce(m->>'full_name', '')), 120);

  -- Novo grupo: quem se cadastra vira a Diretoria do grupo (teste de 14 dias). Slug inválido/ocupado: não cria nada.
  oslug := lower(trim(coalesce(m->>'new_org_slug', '')));
  if oslug <> '' then
    oname := left(trim(coalesce(m->>'new_org_name', '')), 80);
    if oname <> '' and public.slug_available(oslug) then
      insert into public.organizations (slug, name, status, trial_ends_at) values (oslug, oname, 'teste', now() + interval '14 days')
      returning id into tn;
      insert into public.profiles (tenant_id, id, full_name, role) values (tn, new.id, case when nm = '' then new.email else nm end, 'admin');
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

-- ───────── Diretoria edita a identidade do próprio grupo ─────────
create function public.update_organization(p_name text, p_logo_url text, p_primary_color text, p_website text, p_tagline text)
returns void language plpgsql security definer set search_path = public as $$
declare tn uuid := public.current_tenant(); nm text := trim(coalesce(p_name, ''));
begin
  if not public.is_admin() or tn is null then raise exception 'Apenas a Diretoria'; end if;
  if length(nm) < 1 or length(nm) > 80 then raise exception 'Informe o nome do grupo (até 80 caracteres)'; end if;
  if nullif(trim(coalesce(p_logo_url, '')), '') is not null and trim(p_logo_url) !~ '^https://[^\s]{3,255}$' then
    raise exception 'O logotipo precisa ser um endereço https';
  end if;
  if nullif(trim(coalesce(p_primary_color, '')), '') is not null and trim(p_primary_color) !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Cor inválida (use o formato #0057B8)';
  end if;
  update public.organizations set name = nm,
         logo_url = nullif(trim(coalesce(p_logo_url, '')), ''),
         primary_color = nullif(trim(coalesce(p_primary_color, '')), ''),
         website = nullif(left(trim(coalesce(p_website, '')), 120), ''),
         tagline = nullif(left(trim(coalesce(p_tagline, '')), 80), '')
   where id = tn;
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
    values (tn, auth.uid(), 'UPDATE_ORGANIZATION', 'organizations', tn::text, jsonb_build_object('name', nm));
end $$;

revoke execute on function public.slug_available(text), public.org_public(text), public.update_organization(text, text, text, text, text) from public;
grant execute on function public.slug_available(text), public.org_public(text) to anon, authenticated;
grant execute on function public.update_organization(text, text, text, text, text) to authenticated;
