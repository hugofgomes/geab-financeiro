-- Painel do SaaS (entrega 4): planos com limite de administradores, módulos por plano, duração do teste editável e referência para gateway.
-- Aditiva: planos existentes mantêm todos os módulos e nenhum limite novo (nada muda para quem já usa). Reversão no fim do arquivo.

alter table public.plans
  add column max_admins integer check (max_admins is null or max_admins > 0),                 -- nulo = ilimitado
  add column modules text[] not null default array['importar', 'ao_vivo', 'pix', 'mensagens'],
  add column trial_days integer not null default 10 check (trial_days between 1 and 90),
  add column gateway_ref text check (gateway_ref is null or length(gateway_ref) <= 100);       -- id do plano no gateway (preparação; hoje a cobrança usa o preço do plano)

-- Catálogo de módulos que podem ser ligados/desligados por plano.
create function public.plan_modules_valid(m text[]) returns boolean
language sql immutable as $$ select m <@ array['importar', 'ao_vivo', 'pix', 'mensagens'] $$;
alter table public.plans add constraint plans_modules_valid check (public.plan_modules_valid(modules));

update public.plans set name = 'Profissional' where code = 'pro';
-- Premium: criado inativo e sem preço; o dono define valor e limites na tela de planos e então ativa.
insert into public.plans (code, name, price_cents, max_athletes, active, sort_order) values ('premium', 'Premium', 0, null, false, 4)
  on conflict (code) do nothing;

-- Duração do teste vem do plano 'teste' (o gatilho antigo fixava 10 dias).
create or replace function public.org_trial_default() returns trigger language plpgsql as $$
begin
  if new.status = 'teste' then
    new.trial_ends_at := now() + make_interval(days => coalesce((select trial_days from public.plans where id = new.plan_id), (select trial_days from public.plans where code = 'teste'), 10));
  end if;
  return new;
end $$;

-- Limite de administradores do plano (como o limite de atletas: só barra NOVOS administradores).
create function public.enforce_admin_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  if new.role <> 'admin' or not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.role = 'admin' and old.active and old.tenant_id = new.tenant_id then return new; end if;
  select p.max_admins into lim from public.organizations o join public.plans p on p.id = o.plan_id where o.id = new.tenant_id;
  if lim is not null then
    select count(*) into n from public.profiles where tenant_id = new.tenant_id and role = 'admin' and active and id <> new.id;
    if n >= lim then raise exception 'Limite de % administrador(es) do plano atingido. Fale com o suporte para ampliar o plano.', lim; end if;
  end if;
  return new;
end $$;
create trigger profiles_admin_limit before insert or update of role, active on public.profiles
  for each row execute function public.enforce_admin_limit();

-- Módulos do plano do grupo de quem está logado (o servidor e o menu consultam isto).
create function public.my_modules() returns text[]
language sql stable security definer set search_path = public as $$
  select pl.modules from public.profiles p join public.organizations o on o.id = p.tenant_id join public.plans pl on pl.id = o.plan_id where p.id = auth.uid() and p.active
$$;

drop function public.sa_plans();
create function public.sa_plans()
returns table (code text, name text, price_cents int, max_athletes int, active boolean, sort_order smallint, orgs int, max_admins int, modules text[], trial_days int, gateway_ref text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sa_guard();
  return query
  select p.code, p.name, p.price_cents, p.max_athletes, p.active, p.sort_order,
         (select count(*)::int from public.organizations o where o.plan_id = p.id and o.status in ('teste', 'ativa')),
         p.max_admins, p.modules, p.trial_days, p.gateway_ref
  from public.plans p order by p.sort_order, p.code;
end $$;

drop function public.sa_upsert_plan(text, text, int, int, boolean);
create function public.sa_upsert_plan(p_code text, p_name text, p_price_cents int, p_max_athletes int, p_active boolean,
  p_max_admins int default null, p_modules text[] default null, p_trial_days int default null, p_gateway_ref text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sa_guard();
  if p_modules is not null and not public.plan_modules_valid(p_modules) then raise exception 'Módulo inválido'; end if;
  insert into public.plans (code, name, price_cents, max_athletes, active, max_admins, modules, trial_days, gateway_ref)
  values (p_code, p_name, p_price_cents, p_max_athletes, coalesce(p_active, true), p_max_admins,
          coalesce(p_modules, array['importar', 'ao_vivo', 'pix', 'mensagens']), coalesce(p_trial_days, 10), nullif(trim(coalesce(p_gateway_ref, '')), ''))
  on conflict (code) do update set name = excluded.name, price_cents = excluded.price_cents, max_athletes = excluded.max_athletes, active = excluded.active,
    max_admins = excluded.max_admins, modules = coalesce(p_modules, public.plans.modules), trial_days = coalesce(p_trial_days, public.plans.trial_days),
    gateway_ref = excluded.gateway_ref;
end $$;

revoke execute on function public.plan_modules_valid(text[]), public.my_modules(), public.sa_plans(),
  public.sa_upsert_plan(text, text, int, int, boolean, int, text[], int, text) from public, anon;
grant execute on function public.my_modules(), public.sa_plans(), public.sa_upsert_plan(text, text, int, int, boolean, int, text[], int, text) to authenticated;
grant execute on function public.plan_modules_valid(text[]) to authenticated, service_role;

-- Reversão:
--   drop trigger profiles_admin_limit on public.profiles; drop function public.enforce_admin_limit(), public.my_modules();
--   alter table public.plans drop constraint plans_modules_valid; drop function public.plan_modules_valid(text[]);
--   alter table public.plans drop column max_admins, drop column modules, drop column trial_days, drop column gateway_ref;
--   delete from public.plans where code = 'premium' and not exists (select 1 from public.organizations o where o.plan_id = plans.id);
--   update public.plans set name = 'Pro' where code = 'pro';
--   (e recriar sa_plans, sa_upsert_plan e org_trial_default com as definições das migrations 0018 e 0022)
