-- Módulo QUADRA ESPORTIVA, Fase 1 (estrutura): módulo no plano, tipo de organização, centro esportivo, quadras e perfis do módulo.
-- Autocontido e portátil: tabelas court_* e funções court_*; os pontos de contato com o sistema são resolve_tenant()/current_tenant(),
-- profiles (perfil admin), plans.modules, tenant_guard()/tenant_ref_check()/audit() e block_support_writes() (modo espião).
-- Só adiciona (nada existente é alterado, exceto a lista de módulos válidos e sa_plans/sa_upsert_plan, que ganham max_courts). Reversão no fim.

-- ───────── Módulo no plano ─────────
create or replace function public.plan_modules_valid(m text[]) returns boolean
language sql immutable as $$ select m <@ array['importar', 'ao_vivo', 'pix', 'mensagens', 'quadras'] $$;
alter table public.plans add column max_courts integer check (max_courts is null or max_courts > 0);     -- nulo = ilimitado

drop function public.sa_plans();
create function public.sa_plans()
returns table (code text, name text, price_cents int, max_athletes int, active boolean, sort_order smallint, orgs int, max_admins int, modules text[], trial_days int, gateway_ref text, max_courts int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sa_guard();
  return query
  select p.code, p.name, p.price_cents, p.max_athletes, p.active, p.sort_order,
         (select count(*)::int from public.organizations o where o.plan_id = p.id and o.status in ('teste', 'ativa')),
         p.max_admins, p.modules, p.trial_days, p.gateway_ref, p.max_courts
  from public.plans p order by p.sort_order, p.code;
end $$;
drop function public.sa_upsert_plan(text, text, int, int, boolean, int, text[], int, text);
create function public.sa_upsert_plan(p_code text, p_name text, p_price_cents int, p_max_athletes int, p_active boolean,
  p_max_admins int default null, p_modules text[] default null, p_trial_days int default null, p_gateway_ref text default null, p_max_courts int default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sa_guard();
  if p_modules is not null and not public.plan_modules_valid(p_modules) then raise exception 'Módulo inválido'; end if;
  insert into public.plans (code, name, price_cents, max_athletes, active, max_admins, modules, trial_days, gateway_ref, max_courts)
  values (p_code, p_name, p_price_cents, p_max_athletes, coalesce(p_active, true), p_max_admins,
          coalesce(p_modules, array['importar', 'ao_vivo', 'pix', 'mensagens']), coalesce(p_trial_days, 10), nullif(trim(coalesce(p_gateway_ref, '')), ''), p_max_courts)
  on conflict (code) do update set name = excluded.name, price_cents = excluded.price_cents, max_athletes = excluded.max_athletes, active = excluded.active,
    max_admins = excluded.max_admins, modules = coalesce(p_modules, public.plans.modules), trial_days = coalesce(p_trial_days, public.plans.trial_days),
    gateway_ref = excluded.gateway_ref, max_courts = excluded.max_courts;
end $$;
revoke execute on function public.sa_plans(), public.sa_upsert_plan(text, text, int, int, boolean, int, text[], int, text, int) from public, anon;
grant execute on function public.sa_plans(), public.sa_upsert_plan(text, text, int, int, boolean, int, text[], int, text, int) to authenticated;

-- ───────── Tipo de organização ─────────
alter table public.organizations add column kind text not null default 'grupo' check (kind in ('grupo', 'quadra'));
create function public.sa_set_org_kind(p_org uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sa_guard();
  if p_kind not in ('grupo', 'quadra') then raise exception 'Tipo inválido'; end if;
  update public.organizations set kind = p_kind where id = p_org;
  if not found then raise exception 'Grupo não encontrado'; end if;
  perform public.sa_log(p_org, 'SA_SET_KIND', jsonb_build_object('kind', p_kind));
end $$;
revoke execute on function public.sa_set_org_kind(uuid, text) from public, anon;
grant execute on function public.sa_set_org_kind(uuid, text) to authenticated;
-- Detalhe do cliente passa a informar o tipo.
create or replace function public.sa_org_detail(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.sa_guard();
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'Grupo não encontrado'; end if;
  select jsonb_build_object(
    'org', (select jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'status', o.status, 'created_at', o.created_at,
              'trial_ends_at', o.trial_ends_at, 'cancelled_at', o.cancelled_at, 'logo_url', o.logo_url, 'primary_color', o.primary_color,
              'website', o.website, 'tagline', o.tagline, 'card_footer', o.card_footer,
              'broadcast_opt_out', coalesce(i.broadcast_opt_out, false), 'kind', o.kind, 'status_reason', i.status_reason, 'suspended_at', i.suspended_at, 'suspended_by', (select u.email from auth.users u where u.id = i.suspended_by),
              'deleted_at', i.deleted_at, 'deleted_by', (select u.email from auth.users u where u.id = i.deleted_by), 'purge_after', i.purge_after, 'prev_status', i.prev_status, 'notes', i.notes, 'contact_name', i.contact_name, 'contact_email', i.contact_email, 'contact_phone', i.contact_phone,
              'plan_code', p.code, 'plan_name', p.name, 'plan_price_cents', p.price_cents, 'plan_max_athletes', p.max_athletes)
            from public.organizations o join public.plans p on p.id = o.plan_id left join public.org_internal i on i.org_id = o.id where o.id = p_org),
    'usage', jsonb_build_object(
      'athletes_active', (select count(*) from public.athletes where tenant_id = p_org and active),
      'athletes_total', (select count(*) from public.athletes where tenant_id = p_org),
      'users_total', (select count(*) from public.profiles where tenant_id = p_org),
      'users_active', (select count(*) from public.profiles where tenant_id = p_org and active),
      'matches', (select count(*) from public.matches where tenant_id = p_org),
      'matches_30d', (select count(*) from public.matches where tenant_id = p_org and match_date >= current_date - 30),
      'by_role', coalesce((select jsonb_object_agg(role, n) from (select role::text, count(*) n from public.profiles where tenant_id = p_org and active group by role) x), '{}'::jsonb)),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('name', pr.full_name, 'email', u.email, 'role', pr.role, 'active', pr.active,
                'last_access', (select max(l.last_at) from public.access_log l where l.user_id = pr.id)) order by pr.role, pr.full_name)
              from public.profiles pr join auth.users u on u.id = pr.id where pr.tenant_id = p_org and pr.role in ('admin', 'diretoria')), '[]'::jsonb),
    'billing', coalesce((select jsonb_build_object('paid_until', b.paid_until, 'last_event', b.last_event, 'updated_at', b.updated_at,
                'has_subscription', b.asaas_subscription_id is not null, 'plan_code', b.plan_code)
              from public.org_billing b where b.org_id = p_org), '{}'::jsonb),
    'access', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'users', d.users, 'hits', d.hits) order by d.day desc)
              from (select day, count(*) users, sum(hits) hits from public.access_log where tenant_id = p_org group by day order by day desc limit 30) d), '[]'::jsonb),
    'changes', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'detail', a.detail) order by a.at desc)
              from (select at, action, detail from public.audit_log where tenant_id = p_org and action like 'SA\_%' order by at desc limit 50) a), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- ───────── Validação de documentos (feita no banco) ─────────
create function public.court_valid_cpf(c text) returns boolean
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(c, ''), '\D', '', 'g'); s int := 0; i int; r int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end $$;
create function public.court_valid_cnpj(c text) returns boolean
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(c, ''), '\D', '', 'g'); w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2]; s int := 0; i int; r int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then return false; end if;
  for i in 1..12 loop s := s + substr(d, i, 1)::int * w1[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  if r <> substr(d, 13, 1)::int then return false; end if;
  s := 0; for i in 1..13 loop s := s + substr(d, i, 1)::int * w2[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  return r = substr(d, 14, 1)::int;
end $$;

-- ───────── Perfis do módulo (equipe) ─────────
-- Administrador do estabelecimento = admin do grupo (profiles.role). Os demais perfis ficam nesta tabela (Fase 3 traz as telas).
create table public.court_staff (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.resolve_tenant() references public.organizations(id),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  role text not null check (role in ('gerente', 'recepcionista', 'financeiro')),
  position text check (position is null or length(position) <= 60),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index court_staff_tenant_idx on public.court_staff (tenant_id);

-- O módulo está ligado no plano do grupo atual?
create function public.court_module_on() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select 'quadras' = any (pl.modules) from public.organizations o join public.plans pl on pl.id = o.plan_id where o.id = public.current_tenant()), false)
$$;

-- Perfil de quem está logado no módulo: admin | gerente | recepcionista | financeiro | nulo (sem acesso). Sem o módulo no plano, ninguém acessa.
-- Em modo espião o dono enxerga como admin (a escrita continua bloqueada pelo gatilho do modo espião).
create function public.court_role() returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.current_tenant() is null or not public.court_module_on() then null
    when public.in_support_mode() then 'admin'
    when exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin' and p.tenant_id = public.current_tenant()) then 'admin'
    else (select s.role from public.court_staff s where s.profile_id = auth.uid() and s.active and s.tenant_id = public.current_tenant())
  end
$$;

-- ───────── Centro esportivo (um por organização) ─────────
create table public.court_venues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique default public.resolve_tenant() references public.organizations(id),
  trade_name text not null check (length(trim(trade_name)) between 2 and 100),
  legal_name text check (legal_name is null or length(legal_name) <= 150),
  doc_type text check (doc_type is null or doc_type in ('cpf', 'cnpj')),
  document text,                                  -- só dígitos, validado
  description text check (description is null or length(description) <= 1000),
  logo_url text check (logo_url is null or logo_url ~ '^https://[^/\s]+/storage/v1/object/public/quadras/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'),
  phone text check (phone is null or phone ~ '^[0-9]{10,15}$'),
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{10,15}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  website text check (website is null or length(website) <= 160),
  instagram text check (instagram is null or length(instagram) <= 100),
  facebook text check (facebook is null or length(facebook) <= 160),
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  street text check (street is null or length(street) <= 150),
  number text check (number is null or length(number) <= 20),
  complement text check (complement is null or length(complement) <= 80),
  district text check (district is null or length(district) <= 80),
  city text check (city is null or length(city) <= 80),
  state text check (state is null or state in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  timezone text not null default 'America/Sao_Paulo' check (length(timezone) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create function public.court_venue_validate() returns trigger
language plpgsql as $$
begin
  new.document := nullif(regexp_replace(coalesce(new.document, ''), '\D', '', 'g'), '');
  if new.document is not null then
    if new.doc_type = 'cpf' and not public.court_valid_cpf(new.document) then raise exception 'CPF inválido'; end if;
    if new.doc_type = 'cnpj' and not public.court_valid_cnpj(new.document) then raise exception 'CNPJ inválido'; end if;
    if new.doc_type is null then raise exception 'Informe se o documento é CPF ou CNPJ'; end if;
  end if;
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then raise exception 'Fuso horário inválido'; end if;
  new.updated_at := now();
  return new;
end $$;

-- ───────── Quadras ─────────
create table public.court_courts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.resolve_tenant() references public.organizations(id),
  venue_id uuid not null references public.court_venues(id),
  name text not null check (length(trim(name)) between 2 and 80),
  description text check (description is null or length(description) <= 500),
  sport text not null check (sport in ('futebol_society', 'futsal', 'futebol_campo', 'volei', 'volei_praia', 'beach_tennis', 'basquete', 'tenis', 'padel', 'outra')),
  floor_type text check (floor_type is null or floor_type in ('grama_sintetica', 'grama_natural', 'cimento', 'madeira', 'areia', 'saibro', 'borracha', 'outro')),
  covered boolean not null default false,
  lighting boolean not null default false,
  capacity integer check (capacity is null or capacity between 1 and 200),
  photos text[] not null default '{}' check (cardinality(photos) <= 8),
  price_cents integer not null default 0 check (price_cents between 0 and 1000000),     -- valor base por horário (as regras de preço vêm na Fase 2)
  active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index court_courts_name_uniq on public.court_courts (tenant_id, lower(trim(name)));
create index court_courts_tenant_idx on public.court_courts (tenant_id, active);
create function public.court_court_validate() returns trigger
language plpgsql as $$
declare p text;
begin
  foreach p in array new.photos loop
    if p !~ '^https://[^/\s]+/storage/v1/object/public/quadras/[0-9a-f-]{36}/[A-Za-z0-9._-]+$' then raise exception 'Foto inválida: envie pela própria tela'; end if;
  end loop;
  new.updated_at := now();
  return new;
end $$;

-- Limite de quadras ativas do plano (como o limite de atletas).
create function public.enforce_court_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  if not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active then return new; end if;
  select p.max_courts into lim from public.organizations o join public.plans p on p.id = o.plan_id where o.id = new.tenant_id;
  if lim is not null then
    select count(*) into n from public.court_courts where tenant_id = new.tenant_id and active and id is distinct from new.id;
    if n >= lim then raise exception 'Limite de % quadra(s) ativa(s) do plano atingido. Fale com o suporte para ampliar o plano.', lim; end if;
  end if;
  return new;
end $$;

-- ───────── Proteções, auditoria e regras de acesso ─────────
do $$
declare t text;
begin
  foreach t in array array['court_staff', 'court_venues', 'court_courts']
  loop
    execute format('create trigger a_support_readonly before insert or update or delete on public.%I for each row execute function public.block_support_writes()', t);
    execute format('create trigger a_tenant_guard before insert or update or delete on public.%I for each row execute function public.tenant_guard()', t);
    execute format('create trigger z_audit after insert or update or delete on public.%I for each row execute function public.audit()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
create trigger b_tenant_refs before insert or update on public.court_courts for each row execute function public.tenant_ref_check('venue_id:court_venues');
create trigger c_validate before insert or update on public.court_venues for each row execute function public.court_venue_validate();
create trigger c_validate before insert or update on public.court_courts for each row execute function public.court_court_validate();
create trigger d_court_limit before insert or update of active on public.court_courts for each row execute function public.enforce_court_limit();

create policy court_venues_read on public.court_venues for select using (public.court_role() is not null and tenant_id = public.current_tenant());
create policy court_venues_write on public.court_venues for all using (public.court_role() = 'admin' and tenant_id = public.current_tenant()) with check (public.court_role() = 'admin' and tenant_id = public.current_tenant());
create policy court_courts_read on public.court_courts for select using (public.court_role() is not null and tenant_id = public.current_tenant());
create policy court_courts_write on public.court_courts for all using (public.court_role() in ('admin', 'gerente') and tenant_id = public.current_tenant()) with check (public.court_role() in ('admin', 'gerente') and tenant_id = public.current_tenant());
create policy court_staff_read on public.court_staff for select using (tenant_id = public.current_tenant() and (public.court_role() = 'admin' or profile_id = auth.uid()));
create policy court_staff_write on public.court_staff for all using (public.court_role() = 'admin' and tenant_id = public.current_tenant()) with check (public.court_role() = 'admin' and tenant_id = public.current_tenant());

revoke execute on function public.court_module_on(), public.court_role(), public.court_valid_cpf(text), public.court_valid_cnpj(text) from public, anon;
grant execute on function public.court_module_on(), public.court_role() to authenticated;
grant execute on function public.court_valid_cpf(text), public.court_valid_cnpj(text) to authenticated, service_role;

-- ───────── Armazenamento de logo e fotos (só existe no Supabase) ─────────
-- Pasta = id do estabelecimento: cada um só grava na própria pasta, e só administrador/gerente.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('quadras', 'quadras', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];
    execute 'drop policy if exists quadras_grava_na_propria_pasta on storage.objects';
    execute $p$create policy quadras_grava_na_propria_pasta on storage.objects for all to authenticated
      using (bucket_id = 'quadras' and (storage.foldername(name))[1] = public.current_tenant()::text and public.court_role() in ('admin', 'gerente'))
      with check (bucket_id = 'quadras' and (storage.foldername(name))[1] = public.current_tenant()::text and public.court_role() in ('admin', 'gerente'))$p$;
  end if;
end $$;

-- Reversão:
--   drop table public.court_courts, public.court_venues, public.court_staff;
--   drop function public.court_role(), public.court_module_on(), public.court_venue_validate(), public.court_court_validate(), public.enforce_court_limit(),
--     public.court_valid_cpf(text), public.court_valid_cnpj(text), public.sa_set_org_kind(uuid, text);
--   alter table public.organizations drop column kind;  alter table public.plans drop column max_courts;
--   (recriar plan_modules_valid, sa_plans, sa_upsert_plan e sa_org_detail com as definições anteriores: 0028 e 0033)
--   delete from storage.objects where bucket_id = 'quadras'; delete from storage.buckets where id = 'quadras';
