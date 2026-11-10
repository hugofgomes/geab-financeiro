-- Etapa 4 do SaaS: teste de 10 dias com bloqueio automático e assinatura (Asaas).
-- O bloqueio é decidido pelo próprio banco a cada acesso (sem depender de agendador): passou do prazo, o grupo perde o acesso.

-- Grupo utilizável: ativo, ou em teste dentro do prazo.
create function public.org_usable(p_status text, p_trial timestamptz) returns boolean
language sql stable as $$
  select p_status = 'ativa' or (p_status = 'teste' and coalesce(p_trial, now() - interval '1 second') > now())
$$;

create or replace function public.current_tenant() returns uuid
language sql stable security definer set search_path = public as $$
  select p.tenant_id from public.profiles p join public.organizations o on o.id = p.tenant_id
  where p.id = auth.uid() and p.active and public.org_usable(o.status, o.trial_ends_at)
$$;

create or replace function public.org_public(p_slug text default null)
returns table (slug text, name text, logo_url text, primary_color text, website text, tagline text)
language sql stable security definer set search_path = public as $$
  select o.slug, o.name, o.logo_url, o.primary_color, o.website, o.tagline from public.organizations o
  where public.org_usable(o.status, o.trial_ends_at)
    and (o.slug = p_slug or (p_slug is null and o.id = public.default_tenant()))
$$;

-- Todo grupo novo em teste nasce com 10 dias (o cadastro antigo gravava 14).
create function public.org_trial_default() returns trigger language plpgsql as $$
begin
  if new.status = 'teste' then new.trial_ends_at := now() + interval '10 days'; end if;
  return new;
end $$;
create trigger organizations_trial_default before insert on public.organizations for each row execute function public.org_trial_default();

-- Preços dos planos (centavos)
update public.plans set price_cents = 9900 where code = 'basico';
update public.plans set price_cents = 15000 where code = 'pro';

-- ───────── Assinatura ─────────
create table public.org_billing (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  asaas_customer_id text,
  asaas_subscription_id text unique,
  plan_code text,
  paid_until timestamptz,
  last_event text,
  updated_at timestamptz not null default now()
);
alter table public.org_billing enable row level security;   -- sem políticas: só as funções abaixo acessam
revoke all on public.org_billing from anon, authenticated;

-- Situação do grupo de quem está logado. Funciona mesmo com o grupo bloqueado (é como a tela de assinatura sabe o que mostrar).
create function public.my_billing() returns table (
  org_name text, status text, usable boolean, trial_ends_at timestamptz, trial_days_left int,
  plan_code text, plan_name text, price_cents int, max_athletes int, paid_until timestamptz, is_admin boolean, has_subscription boolean)
language sql stable security definer set search_path = public as $$
  select o.name, o.status, public.org_usable(o.status, o.trial_ends_at), o.trial_ends_at,
         case when o.status = 'teste' then greatest(0, ceil(extract(epoch from (o.trial_ends_at - now())) / 86400))::int end,
         pl.code, pl.name, pl.price_cents, pl.max_athletes, b.paid_until, (p.role = 'admin'), (b.asaas_subscription_id is not null)
  from public.profiles p
  join public.organizations o on o.id = p.tenant_id
  join public.plans pl on pl.id = o.plan_id
  left join public.org_billing b on b.org_id = o.id
  where p.id = auth.uid() and p.active
$$;
revoke execute on function public.my_billing() from public, anon;
grant execute on function public.my_billing() to authenticated;

-- Planos à venda (nome e preço vêm do banco: o navegador nunca decide o valor cobrado).
create function public.billing_plans() returns table (code text, name text, price_cents int, max_athletes int)
language sql stable security definer set search_path = public as $$
  select code, name, price_cents, max_athletes from public.plans where active and price_cents > 0 order by price_cents
$$;
revoke execute on function public.billing_plans() from public, anon;
grant execute on function public.billing_plans() to authenticated;

-- ── Funções do servidor (só service_role, chamadas pelas rotas /api/assinatura e /api/webhooks/asaas) ──

-- Valida quem quer assinar: precisa ser administrador ativo do grupo e o plano precisa existir e ser pago.
create function public.billing_prepare(p_user uuid, p_plan text) returns table (org_id uuid, org_name text, price_cents int, asaas_customer_id text, asaas_subscription_id text, trial_ends_at timestamptz, status text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare o public.organizations; pl public.plans; pr public.profiles;
begin
  select * into pr from public.profiles where id = p_user and active and role = 'admin';
  if not found then raise exception 'Apenas o administrador do grupo pode assinar'; end if;
  select * into o from public.organizations where id = pr.tenant_id;
  if o.status = 'cancelada' then raise exception 'Grupo cancelado. Fale com o suporte'; end if;
  select * into pl from public.plans where code = p_plan and active and price_cents > 0;
  if not found then raise exception 'Plano indisponível'; end if;
  return query select o.id, o.name, pl.price_cents, b.asaas_customer_id, b.asaas_subscription_id, o.trial_ends_at, o.status
    from (select 1) x left join public.org_billing b on b.org_id = o.id;
end $$;

create function public.billing_attach(p_org uuid, p_customer text, p_subscription text, p_plan text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.org_billing (org_id, asaas_customer_id, asaas_subscription_id, plan_code, last_event)
  values (p_org, p_customer, p_subscription, p_plan, 'ASSINATURA_CRIADA')
  on conflict (org_id) do update set asaas_customer_id = excluded.asaas_customer_id, asaas_subscription_id = excluded.asaas_subscription_id,
    plan_code = excluded.plan_code, last_event = excluded.last_event, updated_at = now();
end $$;

-- Evento do Asaas → situação do grupo. Idempotente: repetir o mesmo evento não muda nada.
--   pagamento confirmado/recebido: grupo ativo no plano contratado, com acesso até paid_until
--   pagamento vencido: suspende (motivo "inadimplência"), volta sozinho quando pagar
--   assinatura removida/inativada: cancelada
create function public.billing_event(p_subscription text, p_event text, p_paid_until timestamptz default null) returns text
language plpgsql security definer set search_path = public as $$
declare b public.org_billing; o public.organizations; reason text;
begin
  select * into b from public.org_billing where asaas_subscription_id = p_subscription;
  if not found then return 'desconhecida'; end if;
  select * into o from public.organizations where id = b.org_id for update;
  update public.org_billing set last_event = left(p_event, 60), updated_at = now() where org_id = b.org_id;

  if p_event in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED') then
    select status_reason into reason from public.org_internal where org_id = o.id;
    if o.status = 'cancelada' or (o.status = 'suspensa' and coalesce(reason, '') not like 'inadimplência%') then return 'ignorada'; end if;  -- suspensão/cancelamento manual não é desfeito por pagamento
    update public.organizations set status = 'ativa', plan_id = (select id from public.plans where code = b.plan_code) where id = o.id;
    update public.org_billing set paid_until = coalesce(p_paid_until, now() + interval '31 days') where org_id = o.id;
    update public.org_internal set status_reason = null where org_id = o.id and status_reason like 'inadimplência%';
    return 'ativa';
  elsif p_event = 'PAYMENT_OVERDUE' then
    if o.status = 'ativa' then
      update public.organizations set status = 'suspensa' where id = o.id;
      insert into public.org_internal (org_id, status_reason) values (o.id, 'inadimplência (cobrança vencida)')
        on conflict (org_id) do update set status_reason = excluded.status_reason, updated_at = now();
      return 'suspensa';
    end if;
    return 'ignorada';
  elsif p_event in ('SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED') then
    update public.organizations set status = 'cancelada' where id = o.id;
    return 'cancelada';
  end if;
  return 'ignorada';
end $$;

revoke execute on function public.org_usable(text, timestamptz), public.billing_prepare(uuid, text), public.billing_attach(uuid, text, text, text),
  public.billing_event(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.org_usable(text, timestamptz) to authenticated, service_role;
grant execute on function public.billing_prepare(uuid, text), public.billing_attach(uuid, text, text, text), public.billing_event(text, text, timestamptz) to service_role;
