-- Etapa 3 do SaaS: painel do dono da plataforma (super admin), planos e limites.
-- O super admin enxerga só AGREGADOS por grupo (contagens, plano, situação). Nunca nomes de atletas, pagamentos ou contatos:
-- as tabelas continuam isoladas por organização e o acesso do dono é feito só por funções sa_* específicas.

-- ───────── Dono da plataforma ─────────
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;   -- sem políticas: ninguém lê pelo navegador

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- ───────── Planos ─────────
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{2,30}$'),
  name text not null check (length(trim(name)) between 1 and 60),
  price_cents integer not null default 0 check (price_cents >= 0),     -- mensalidade do plano (valores iniciais são exemplos: ajuste no painel)
  max_athletes integer check (max_athletes is null or max_athletes > 0), -- nulo = ilimitado
  active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.plans enable row level security;
create policy plans_read on public.plans for select using (true);       -- preços e limites são públicos

insert into public.plans (code, name, price_cents, max_athletes, sort_order) values
  ('teste',     'Teste gratuito',      0,    30, 1),
  ('basico',    'Básico',           2990,    60, 2),
  ('pro',       'Pro',              5990,   200, 3),
  ('ilimitado', 'Ilimitado (interno)', 0, null, 9);

alter table public.organizations add column plan_id uuid references public.plans(id);
update public.organizations set plan_id = (select id from public.plans where code = case when slug = 'geab' then 'ilimitado' else 'teste' end);
alter table public.organizations alter column plan_id set not null;

create function public.organizations_default_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.plan_id is null then new.plan_id := (select id from public.plans where code = 'teste'); end if;
  return new;
end $$;
create trigger organizations_default_plan before insert on public.organizations
  for each row execute function public.organizations_default_plan();

-- Anotações internas do dono (os grupos nunca as leem: sem políticas).
create table public.org_internal (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  notes text check (notes is null or length(notes) <= 2000),
  status_reason text check (status_reason is null or length(status_reason) <= 300),
  updated_at timestamptz not null default now()
);
alter table public.org_internal enable row level security;

-- ───────── Limite do plano ─────────
create function public.enforce_athlete_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  if not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active then return new; end if;     -- já contava
  select p.max_athletes into lim from public.organizations o join public.plans p on p.id = o.plan_id where o.id = new.tenant_id;
  if lim is not null then
    select count(*) into n from public.athletes where tenant_id = new.tenant_id and active and id is distinct from new.id;
    if n >= lim then raise exception 'Limite de % atletas ativos do plano atingido. Fale com o suporte para ampliar o plano.', lim; end if;
  end if;
  return new;
end $$;
create trigger athletes_plan_limit before insert or update of active on public.athletes
  for each row execute function public.enforce_athlete_limit();

-- ───────── Funções do super admin ─────────
create function public.sa_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Acesso restrito à plataforma'; end if;
end $$;

create function public.sa_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.sa_guard();
  select jsonb_build_object(
    'orgs_total', count(*),
    'orgs_teste', count(*) filter (where o.status = 'teste'),
    'orgs_ativa', count(*) filter (where o.status = 'ativa'),
    'orgs_suspensa', count(*) filter (where o.status = 'suspensa'),
    'orgs_cancelada', count(*) filter (where o.status = 'cancelada'),
    'new_30d', count(*) filter (where o.created_at > now() - interval '30 days'),
    'trials_expiring', count(*) filter (where o.status = 'teste' and o.trial_ends_at < now() + interval '3 days'),
    'mrr_cents', coalesce(sum(p.price_cents) filter (where o.status = 'ativa'), 0),
    'athletes_total', (select count(*) from public.athletes where active),
    'by_plan', coalesce((select jsonb_agg(x order by x->>'sort') from (
        select jsonb_build_object('plan', pl.name, 'sort', pl.sort_order, 'orgs', count(o2.id) filter (where o2.status in ('teste','ativa')),
                                  'mrr_cents', coalesce(sum(pl.price_cents) filter (where o2.status = 'ativa'), 0)) as x
        from public.plans pl left join public.organizations o2 on o2.plan_id = pl.id group by pl.id) t), '[]'::jsonb)
  ) into r
  from public.organizations o join public.plans p on p.id = o.plan_id;
  return r;
end $$;

create function public.sa_orgs()
returns table (id uuid, slug text, name text, status text, plan_code text, plan_name text, athletes int, athletes_limit int, admins int, matches int,
               created_at timestamptz, trial_ends_at timestamptz, last_activity timestamptz, notes text, status_reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sa_guard();
  return query
  select o.id, o.slug, o.name, o.status, p.code, p.name,
         (select count(*)::int from public.athletes a where a.tenant_id = o.id and a.active),
         p.max_athletes,
         (select count(*)::int from public.profiles pr where pr.tenant_id = o.id and pr.role = 'admin' and pr.active),
         (select count(*)::int from public.matches m where m.tenant_id = o.id),
         o.created_at, o.trial_ends_at,
         (select max(l.at) from public.audit_log l where l.tenant_id = o.id),
         i.notes, i.status_reason
  from public.organizations o
  join public.plans p on p.id = o.plan_id
  left join public.org_internal i on i.org_id = o.id
  order by o.created_at desc;
end $$;

create function public.sa_log(p_org uuid, p_action text, p_detail jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
  values (p_org, auth.uid(), p_action, 'organizations', p_org::text, p_detail)
$$;

create function public.sa_set_org_status(p_org uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sa_guard();
  if p_status not in ('teste', 'ativa', 'suspensa', 'cancelada') then raise exception 'Situação inválida'; end if;
  update public.organizations set status = p_status where id = p_org;
  if not found then raise exception 'Grupo não encontrado'; end if;
  insert into public.org_internal (org_id, status_reason) values (p_org, nullif(left(trim(coalesce(p_reason, '')), 300), ''))
    on conflict (org_id) do update set status_reason = excluded.status_reason, updated_at = now();
  perform public.sa_log(p_org, 'SA_SET_STATUS', jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

create function public.sa_set_org_plan(p_org uuid, p_plan text) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  perform public.sa_guard();
  select id into pid from public.plans where code = p_plan;
  if pid is null then raise exception 'Plano não encontrado'; end if;
  update public.organizations set plan_id = pid where id = p_org;
  if not found then raise exception 'Grupo não encontrado'; end if;
  perform public.sa_log(p_org, 'SA_SET_PLAN', jsonb_build_object('plan', p_plan));
end $$;

create function public.sa_extend_trial(p_org uuid, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sa_guard();
  if p_days is null or p_days < 1 or p_days > 90 then raise exception 'Informe de 1 a 90 dias'; end if;
  update public.organizations set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => p_days) where id = p_org;
  if not found then raise exception 'Grupo não encontrado'; end if;
  perform public.sa_log(p_org, 'SA_EXTEND_TRIAL', jsonb_build_object('days', p_days));
end $$;

create function public.sa_set_notes(p_org uuid, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sa_guard();
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'Grupo não encontrado'; end if;
  insert into public.org_internal (org_id, notes) values (p_org, nullif(left(trim(coalesce(p_notes, '')), 2000), ''))
    on conflict (org_id) do update set notes = excluded.notes, updated_at = now();
end $$;

create function public.sa_plans()
returns table (code text, name text, price_cents int, max_athletes int, active boolean, sort_order smallint, orgs int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sa_guard();
  return query
  select p.code, p.name, p.price_cents, p.max_athletes, p.active, p.sort_order,
         (select count(*)::int from public.organizations o where o.plan_id = p.id and o.status in ('teste', 'ativa'))
  from public.plans p order by p.sort_order, p.code;
end $$;

create function public.sa_upsert_plan(p_code text, p_name text, p_price_cents int, p_max_athletes int, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sa_guard();
  insert into public.plans (code, name, price_cents, max_athletes, active) values (p_code, p_name, p_price_cents, p_max_athletes, coalesce(p_active, true))
  on conflict (code) do update set name = excluded.name, price_cents = excluded.price_cents, max_athletes = excluded.max_athletes, active = excluded.active;
end $$;

-- Cria um grupo pelo painel (já ativo) e vincula um administrador que já tenha conta e ainda não pertença a nenhum grupo.
create function public.sa_create_org(p_slug text, p_name text, p_plan text default 'teste') returns uuid
language plpgsql security definer set search_path = public as $$
declare oid uuid; pid uuid; s text := lower(trim(coalesce(p_slug, '')));
begin
  perform public.sa_guard();
  if not public.slug_available(s) then raise exception 'Endereço indisponível ou inválido'; end if;
  if length(trim(coalesce(p_name, ''))) < 1 then raise exception 'Informe o nome do grupo'; end if;
  select id into pid from public.plans where code = p_plan;
  if pid is null then raise exception 'Plano não encontrado'; end if;
  insert into public.organizations (slug, name, status, plan_id) values (s, left(trim(p_name), 80), 'ativa', pid) returning id into oid;
  perform public.sa_log(oid, 'SA_CREATE_ORG', jsonb_build_object('slug', s, 'plan', p_plan));
  return oid;
end $$;

create function public.sa_assign_admin(p_org uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare u record;
begin
  perform public.sa_guard();
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'Grupo não encontrado'; end if;
  select id, email, raw_user_meta_data into u from auth.users where lower(email) = lower(trim(coalesce(p_email, '')));
  if not found then raise exception 'Nenhuma conta com este e-mail. A pessoa precisa se cadastrar primeiro.'; end if;
  if exists (select 1 from public.profiles where id = u.id) then raise exception 'Esta conta já pertence a um grupo'; end if;
  insert into public.profiles (tenant_id, id, full_name, role)
  values (p_org, u.id, coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), u.email), 'admin');
  perform public.sa_log(p_org, 'SA_ASSIGN_ADMIN', jsonb_build_object('email', u.email));
end $$;

revoke execute on function public.is_platform_admin(), public.sa_guard(), public.sa_overview(), public.sa_orgs(), public.sa_log(uuid, text, jsonb),
  public.sa_set_org_status(uuid, text, text), public.sa_set_org_plan(uuid, text), public.sa_extend_trial(uuid, int), public.sa_set_notes(uuid, text),
  public.sa_plans(), public.sa_upsert_plan(text, text, int, int, boolean), public.sa_create_org(text, text, text), public.sa_assign_admin(uuid, text)
  from public, anon;
grant execute on function public.is_platform_admin(), public.sa_overview(), public.sa_orgs(), public.sa_set_org_status(uuid, text, text),
  public.sa_set_org_plan(uuid, text), public.sa_extend_trial(uuid, int), public.sa_set_notes(uuid, text), public.sa_plans(),
  public.sa_upsert_plan(text, text, int, int, boolean), public.sa_create_org(text, text, text), public.sa_assign_admin(uuid, text) to authenticated;
-- sa_guard e sa_log são internas (chamadas só pelas outras funções sa_*, que são SECURITY DEFINER). No Supabase, funções novas
-- nascem executáveis por authenticated: revogar explicitamente, senão qualquer usuário gravaria auditoria em nome de outro grupo.
revoke execute on function public.sa_guard(), public.sa_log(uuid, text, jsonb) from authenticated, service_role;
