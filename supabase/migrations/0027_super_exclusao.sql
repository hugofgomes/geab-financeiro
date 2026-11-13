-- Painel do SaaS (entrega 3): suspensão com registro, exclusão lógica (com prazo de recuperação), exportação e exclusão definitiva.
-- Exclusão lógica = situação 'excluida': o grupo perde o acesso (org_usable só libera ativa/teste) e NENHUM dado é apagado.
-- A exclusão definitiva só é possível depois do prazo de retenção, digitando o nome do grupo, e apaga SÓ as linhas daquele grupo.
-- Reversão: ver fim do arquivo.

alter table public.org_internal
  add column suspended_at timestamptz, add column suspended_by uuid,
  add column prev_status text, add column deleted_at timestamptz, add column deleted_by uuid, add column purge_after timestamptz;

alter table public.organizations drop constraint organizations_status_check;
alter table public.organizations add constraint organizations_status_check check (status in ('teste', 'ativa', 'suspensa', 'cancelada', 'excluida'));

-- Registro permanente das exclusões definitivas (a organização some, o registro de que existiu fica).
create table public.platform_purges (
  id bigserial primary key,
  org_id uuid not null,
  slug text not null,
  name text not null,
  purged_at timestamptz not null default now(),
  purged_by uuid,
  counts jsonb
);
alter table public.platform_purges enable row level security;   -- sem políticas

-- Funções existentes passam a conhecer a situação 'excluida'.
create or replace function public.billing_event(p_subscription text, p_event text, p_paid_until timestamptz default null) returns text
language plpgsql security definer set search_path = public as $$
declare b public.org_billing; o public.organizations; reason text;
begin
  select * into b from public.org_billing where asaas_subscription_id = p_subscription;
  if not found then return 'desconhecida'; end if;
  select * into o from public.organizations where id = b.org_id for update;
  if o.status = 'excluida' then return 'ignorada'; end if;    -- grupo excluído (aguardando exclusão definitiva) não reage a cobrança
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

create or replace function public.sa_overview() returns jsonb
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
  from public.organizations o join public.plans p on p.id = o.plan_id where o.status <> 'excluida';
  return r;
end $$;

create or replace function public.sa_dashboard(p_months int default 12) returns jsonb
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
  from public.organizations o join public.plans p on p.id = o.plan_id where o.status <> 'excluida'
  on conflict (month) do update set mrr_cents = excluded.mrr_cents, orgs_ativas = excluded.orgs_ativas, orgs_total = excluded.orgs_total, updated_at = now();

  select jsonb_build_object(
    'overdue', (select count(*) from public.organizations o join public.org_internal i on i.org_id = o.id
                where o.status = 'suspensa' and i.status_reason like 'inadimplência%'),
    'trials_expired', (select count(*) from public.organizations where status = 'teste' and trial_ends_at <= now()),
    'new_month', (select count(*) from public.organizations where status <> 'excluida' and created_at >= cur::timestamp at time zone 'America/Sao_Paulo'),
    'cancelled_month', (select count(*) from public.organizations where cancelled_at >= cur::timestamp at time zone 'America/Sao_Paulo'),
    'inactive_30d', (select count(*) from public.organizations o where o.status in ('teste', 'ativa') and o.created_at < now() - interval '30 days'
                     and coalesce((select max(x.last_at) from public.access_log x where x.tenant_id = o.id), 'epoch') < now() - interval '30 days'),
    'growth', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
                 'novos', (select count(*) from public.organizations where status <> 'excluida' and date_trunc('month', created_at at time zone 'America/Sao_Paulo') = m),
                 'total', (select count(*) from public.organizations where status <> 'excluida' and created_at < (m + interval '1 month') at time zone 'America/Sao_Paulo')) order by m), '[]'::jsonb)
               from generate_series((cur - make_interval(months => n - 1))::timestamp, cur::timestamp, interval '1 month') m),
    'mrr', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(month, 'YYYY-MM'), 'mrr_cents', mrr_cents, 'ativas', orgs_ativas) order by month), '[]'::jsonb)
            from public.platform_mrr_history where month >= (cur - make_interval(months => n - 1))::date)
  ) into r;
  return r;
end $$;

create or replace function public.sa_set_org_status(p_org uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sa_guard();
  if p_status not in ('teste', 'ativa', 'suspensa', 'cancelada') then raise exception 'Situação inválida'; end if;
  if exists (select 1 from public.organizations where id = p_org and status = 'excluida') then raise exception 'Grupo excluído: restaure-o antes de alterar a situação'; end if;
  update public.organizations set status = p_status where id = p_org;
  if not found then raise exception 'Grupo não encontrado'; end if;
  insert into public.org_internal (org_id, status_reason, suspended_at, suspended_by)
    values (p_org, nullif(left(trim(coalesce(p_reason, '')), 300), ''), case when p_status = 'suspensa' then now() end, case when p_status = 'suspensa' then auth.uid() end)
    on conflict (org_id) do update set status_reason = excluded.status_reason, suspended_at = excluded.suspended_at, suspended_by = excluded.suspended_by, updated_at = now();
  perform public.sa_log(p_org, 'SA_SET_STATUS', jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

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
              'status_reason', i.status_reason, 'suspended_at', i.suspended_at, 'suspended_by', (select u.email from auth.users u where u.id = i.suspended_by),
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

-- A regra "último administrador" não pode barrar a exclusão definitiva do grupo inteiro: sa_purge_org marca a transação.
create or replace function public.guard_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and current_setting('app.purging_org', true) = old.tenant_id::text then return old; end if;
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id and tenant_id = old.tenant_id) then
    raise exception 'O sistema precisa ter pelo menos um usuário da Diretoria ativo';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- ───────── Situação de bloqueio de quem está logado (tela amigável) ─────────
create function public.my_org_block() returns table (kind text, reason text, org_name text, suspended_at timestamptz)
language sql stable security definer set search_path = public as $$
  select case when o.status = 'excluida' then 'excluida'
              when o.status = 'suspensa' and coalesce(i.status_reason, '') like 'inadimplência%' then 'inadimplencia'
              when o.status = 'suspensa' then 'manual'
              when o.status = 'cancelada' then 'cancelada'
              when o.status = 'teste' and coalesce(o.trial_ends_at, now() - interval '1 second') <= now() then 'teste'
              else 'ok' end,
         case when o.status = 'suspensa' and coalesce(i.status_reason, '') not like 'inadimplência%' then i.status_reason end,
         o.name, i.suspended_at
  from public.profiles p join public.organizations o on o.id = p.tenant_id left join public.org_internal i on i.org_id = o.id
  where p.id = auth.uid()
$$;

-- ───────── Verificação antes de excluir ─────────
create function public.sa_org_delete_check(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.sa_guard();
  select jsonb_build_object('name', o.name, 'status', o.status,
    'athletes', (select count(*) from public.athletes where tenant_id = o.id),
    'users', (select count(*) from public.profiles where tenant_id = o.id),
    'matches', (select count(*) from public.matches where tenant_id = o.id),
    'charges', (select count(*) from public.charges where tenant_id = o.id),
    'payments', (select count(*) from public.payments where tenant_id = o.id),
    'has_subscription', coalesce(b.asaas_subscription_id is not null, false), 'paid_until', b.paid_until,
    'mine', exists (select 1 from public.profiles where id = auth.uid() and tenant_id = o.id))
  into r from public.organizations o left join public.org_billing b on b.org_id = o.id where o.id = p_org;
  if r is null then raise exception 'Grupo não encontrado'; end if;
  return r;
end $$;

-- ───────── Exclusão lógica ─────────
create function public.sa_delete_org(p_org uuid, p_confirm_name text, p_reason text, p_retention_days int default 30) returns void
language plpgsql security definer set search_path = public as $$
declare o public.organizations;
begin
  perform public.sa_guard();
  select * into o from public.organizations where id = p_org for update;
  if not found then raise exception 'Grupo não encontrado'; end if;
  if o.status = 'excluida' then raise exception 'Este grupo já está excluído'; end if;
  if trim(coalesce(p_confirm_name, '')) <> o.name then raise exception 'O nome digitado não confere com o do grupo'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and tenant_id = p_org) then raise exception 'Você não pode excluir o grupo ao qual pertence'; end if;
  if p_retention_days is null or p_retention_days < 7 or p_retention_days > 365 then raise exception 'Prazo de recuperação: de 7 a 365 dias'; end if;
  update public.organizations set status = 'excluida' where id = p_org;
  insert into public.org_internal (org_id, status_reason, prev_status, deleted_at, deleted_by, purge_after)
  values (p_org, 'exclusão: ' || coalesce(nullif(left(trim(coalesce(p_reason, '')), 250), ''), 'sem motivo informado'), o.status, now(), auth.uid(), now() + make_interval(days => p_retention_days))
  on conflict (org_id) do update set status_reason = excluded.status_reason, prev_status = excluded.prev_status, deleted_at = excluded.deleted_at,
    deleted_by = excluded.deleted_by, purge_after = excluded.purge_after, updated_at = now();
  perform public.sa_log(p_org, 'SA_DELETE_ORG', jsonb_build_object('reason', p_reason, 'retention_days', p_retention_days, 'prev_status', o.status));
end $$;

create function public.sa_restore_org(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.org_internal;
begin
  perform public.sa_guard();
  select * into i from public.org_internal where org_id = p_org;
  if not exists (select 1 from public.organizations where id = p_org and status = 'excluida') then raise exception 'Este grupo não está excluído'; end if;
  update public.organizations set status = coalesce(nullif(i.prev_status, 'excluida'), 'suspensa') where id = p_org;
  update public.org_internal set prev_status = null, deleted_at = null, deleted_by = null, purge_after = null, status_reason = null, updated_at = now() where org_id = p_org;
  perform public.sa_log(p_org, 'SA_RESTORE_ORG', jsonb_build_object('status', i.prev_status));
end $$;

-- ───────── Exportação (tudo do grupo, exceto credenciais) ─────────
create function public.sa_org_export(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; rows_ jsonb; r jsonb;
begin
  perform public.sa_guard();
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'Grupo não encontrado'; end if;
  select to_jsonb(o) - 'id' into r from public.organizations o where o.id = p_org;
  r := jsonb_build_object('organizacao', r, 'exportado_em', now(), 'tabelas', '{}'::jsonb);
  for t in select c.table_name from information_schema.columns c
           where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name not in ('btg_connection', 'access_log') order by 1
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where x.tenant_id = $1', t) into rows_ using p_org;
    r := jsonb_set(r, array['tabelas', t], rows_);
  end loop;
  perform public.sa_log(p_org, 'SA_EXPORT_ORG', '{}'::jsonb);
  return r;
end $$;

-- ───────── Exclusão definitiva ─────────
create function public.sa_purge_org(p_org uuid, p_confirm_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.organizations; i public.org_internal; t text; pend text[]; nxt text[]; pass int := 0; n bigint; counts jsonb := '{}'::jsonb; uids uuid[];
begin
  perform public.sa_guard();
  select * into o from public.organizations where id = p_org for update;
  if not found then raise exception 'Grupo não encontrado'; end if;
  select * into i from public.org_internal where org_id = p_org;
  if o.status <> 'excluida' then raise exception 'Exclua o grupo (exclusão lógica) antes da exclusão definitiva'; end if;
  if i.purge_after is null or i.purge_after > now() then raise exception 'O prazo de recuperação vai até %. Só depois dele a exclusão definitiva é permitida', to_char(i.purge_after at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'); end if;
  if trim(coalesce(p_confirm_name, '')) <> o.name then raise exception 'O nome digitado não confere com o do grupo'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and tenant_id = p_org) then raise exception 'Você não pode excluir o grupo ao qual pertence'; end if;

  perform set_config('app.purging_org', p_org::text, true);
  select coalesce(array_agg(p.id), '{}') into uids from public.profiles p where p.tenant_id = p_org and not exists (select 1 from public.platform_admins a where a.user_id = p.id);
  select coalesce(array_agg(c.table_name order by c.table_name), '{}') into pend from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> 'audit_log';
  -- apaga as tabelas do grupo na ordem que as chaves estrangeiras permitirem (repete até acabar)
  while coalesce(array_length(pend, 1), 0) > 0 and pass < 12 loop
    pass := pass + 1; nxt := '{}';
    foreach t in array pend loop
      begin
        execute format('delete from public.%I where tenant_id = $1', t) using p_org;
        get diagnostics n = row_count;
        counts := counts || jsonb_build_object(t, coalesce((counts->>t)::bigint, 0) + n);
      exception when foreign_key_violation then nxt := nxt || t;
      end;
    end loop;
    pend := nxt;
  end loop;
  if coalesce(array_length(pend, 1), 0) > 0 then raise exception 'Não foi possível apagar tudo (dependências em: %)', array_to_string(pend, ', '); end if;
  delete from public.audit_log where tenant_id = p_org;
  delete from auth.users where id = any(uids);
  insert into public.platform_purges (org_id, slug, name, purged_by, counts) values (o.id, o.slug, o.name, auth.uid(), counts);
  delete from public.organizations where id = p_org;
  return counts;
end $$;

revoke execute on function public.my_org_block(), public.sa_org_delete_check(uuid), public.sa_delete_org(uuid, text, text, int), public.sa_restore_org(uuid),
  public.sa_org_export(uuid), public.sa_purge_org(uuid, text) from public, anon;
grant execute on function public.my_org_block(), public.sa_org_delete_check(uuid), public.sa_delete_org(uuid, text, text, int), public.sa_restore_org(uuid),
  public.sa_org_export(uuid), public.sa_purge_org(uuid, text) to authenticated;

-- Reversão (antes de existir qualquer grupo 'excluida'; exclusões definitivas não se desfazem):
--   drop function public.my_org_block(), public.sa_org_delete_check(uuid), public.sa_delete_org(uuid, text, text, int), public.sa_restore_org(uuid),
--     public.sa_org_export(uuid), public.sa_purge_org(uuid, text);
--   drop table public.platform_purges;
--   alter table public.organizations drop constraint organizations_status_check;
--   alter table public.organizations add constraint organizations_status_check check (status in ('teste','ativa','suspensa','cancelada'));
--   alter table public.org_internal drop column suspended_at, drop column suspended_by, drop column prev_status, drop column deleted_at, drop column deleted_by, drop column purge_after;
--   (e recriar guard_last_admin (0016), sa_set_org_status, sa_overview, sa_dashboard, sa_org_detail e billing_event com as definições das migrations 0018, 0025, 0026 e 0022)
