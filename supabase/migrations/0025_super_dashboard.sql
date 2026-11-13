-- Painel do SaaS (entrega 1): contato do responsável, data de cancelamento, histórico mensal de MRR e funções do dashboard.
-- Só ADICIONA colunas/tabelas/funções: nenhum dado existente é alterado (exceto substituir sa_orgs, que ganha colunas).
-- Reversão: drop table platform_mrr_history; drop function sa_dashboard, sa_set_contact; alter table ... drop column (ver fim do arquivo).

alter table public.org_internal
  add column contact_name text check (contact_name is null or length(contact_name) <= 120),
  add column contact_email text check (contact_email is null or length(contact_email) <= 160),
  add column contact_phone text check (contact_phone is null or length(contact_phone) <= 30);

alter table public.organizations add column cancelled_at timestamptz;

create function public.organizations_track_cancel() returns trigger
language plpgsql as $$
begin
  if new.status = 'cancelada' and old.status is distinct from 'cancelada' then new.cancelled_at := now();
  elsif new.status <> 'cancelada' then new.cancelled_at := null; end if;
  return new;
end $$;
create trigger organizations_track_cancel before update of status on public.organizations
  for each row execute function public.organizations_track_cancel();

-- Histórico mensal do MRR (o banco não guardava o passado: a série passa a ser registrada a cada abertura do painel).
create table public.platform_mrr_history (
  month date primary key,
  mrr_cents integer not null,
  orgs_ativas integer not null,
  orgs_total integer not null,
  updated_at timestamptz not null default now()
);
alter table public.platform_mrr_history enable row level security;   -- sem políticas: só funções sa_*

-- Lista de grupos ampliada (contato, vencimento e último acesso). Substitui a versão da 0018.
drop function public.sa_orgs();
create function public.sa_orgs()
returns table (id uuid, slug text, name text, status text, plan_code text, plan_name text, plan_price_cents int, athletes int, athletes_limit int, admins int, matches int,
               created_at timestamptz, trial_ends_at timestamptz, paid_until timestamptz, last_activity timestamptz, last_access timestamptz,
               notes text, status_reason text, contact_name text, contact_email text, contact_phone text, cancelled_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sa_guard();
  return query
  select o.id, o.slug, o.name, o.status, p.code, p.name, p.price_cents,
         (select count(*)::int from public.athletes a where a.tenant_id = o.id and a.active),
         p.max_athletes,
         (select count(*)::int from public.profiles pr where pr.tenant_id = o.id and pr.role = 'admin' and pr.active),
         (select count(*)::int from public.matches m where m.tenant_id = o.id),
         o.created_at, o.trial_ends_at, b.paid_until,
         (select max(l.at) from public.audit_log l where l.tenant_id = o.id),
         (select max(x.last_at) from public.access_log x where x.tenant_id = o.id),
         i.notes, i.status_reason, i.contact_name, i.contact_email, i.contact_phone, o.cancelled_at
  from public.organizations o
  join public.plans p on p.id = o.plan_id
  left join public.org_internal i on i.org_id = o.id
  left join public.org_billing b on b.org_id = o.id
  order by o.created_at desc;
end $$;

create function public.sa_set_contact(p_org uuid, p_name text, p_email text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare e text := nullif(left(trim(coalesce(p_email, '')), 160), '');
begin
  perform public.sa_guard();
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'Grupo não encontrado'; end if;
  if e is not null and e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail do responsável inválido'; end if;
  insert into public.org_internal (org_id, contact_name, contact_email, contact_phone)
  values (p_org, nullif(left(trim(coalesce(p_name, '')), 120), ''), e, nullif(left(trim(coalesce(p_phone, '')), 30), ''))
  on conflict (org_id) do update set contact_name = excluded.contact_name, contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone, updated_at = now();
  perform public.sa_log(p_org, 'SA_SET_CONTACT', '{}'::jsonb);
end $$;

-- Indicadores e séries do dashboard.
create function public.sa_dashboard(p_months int default 12) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n int := greatest(least(coalesce(p_months, 12), 24), 3);
  cur date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  r jsonb;
begin
  perform public.sa_guard();
  -- registra o MRR do mês corrente (um registro por mês, atualizado a cada abertura)
  insert into public.platform_mrr_history (month, mrr_cents, orgs_ativas, orgs_total)
  select cur, coalesce(sum(p.price_cents) filter (where o.status = 'ativa'), 0), count(*) filter (where o.status = 'ativa'), count(*)
  from public.organizations o join public.plans p on p.id = o.plan_id
  on conflict (month) do update set mrr_cents = excluded.mrr_cents, orgs_ativas = excluded.orgs_ativas, orgs_total = excluded.orgs_total, updated_at = now();

  select jsonb_build_object(
    'overdue', (select count(*) from public.organizations o join public.org_internal i on i.org_id = o.id
                where o.status = 'suspensa' and i.status_reason like 'inadimplência%'),
    'trials_expired', (select count(*) from public.organizations where status = 'teste' and trial_ends_at <= now()),
    'new_month', (select count(*) from public.organizations where created_at >= cur::timestamp at time zone 'America/Sao_Paulo'),
    'cancelled_month', (select count(*) from public.organizations where cancelled_at >= cur::timestamp at time zone 'America/Sao_Paulo'),
    'inactive_30d', (select count(*) from public.organizations o where o.status in ('teste', 'ativa') and o.created_at < now() - interval '30 days'
                     and coalesce((select max(x.last_at) from public.access_log x where x.tenant_id = o.id), 'epoch') < now() - interval '30 days'),
    'growth', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
                 'novos', (select count(*) from public.organizations where date_trunc('month', created_at at time zone 'America/Sao_Paulo') = m),
                 'total', (select count(*) from public.organizations where created_at < (m + interval '1 month') at time zone 'America/Sao_Paulo')) order by m), '[]'::jsonb)
               from generate_series((cur - make_interval(months => n - 1))::timestamp, cur::timestamp, interval '1 month') m),
    'mrr', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(month, 'YYYY-MM'), 'mrr_cents', mrr_cents, 'ativas', orgs_ativas) order by month), '[]'::jsonb)
            from public.platform_mrr_history where month >= (cur - make_interval(months => n - 1))::date)
  ) into r;
  return r;
end $$;

revoke execute on function public.sa_orgs(), public.sa_set_contact(uuid, text, text, text), public.sa_dashboard(int) from public, anon;
grant execute on function public.sa_orgs(), public.sa_set_contact(uuid, text, text, text), public.sa_dashboard(int) to authenticated;
revoke execute on function public.organizations_track_cancel() from public, anon, authenticated;

-- Reversão:
--   drop function public.sa_dashboard(int), public.sa_set_contact(uuid, text, text, text); drop table public.platform_mrr_history;
--   drop trigger organizations_track_cancel on public.organizations; drop function public.organizations_track_cancel();
--   alter table public.organizations drop column cancelled_at;
--   alter table public.org_internal drop column contact_name, drop column contact_email, drop column contact_phone;
--   (e recriar sa_orgs() com a definição da 0018)
