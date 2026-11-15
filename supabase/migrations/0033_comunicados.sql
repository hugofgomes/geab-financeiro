-- Comunicados em massa (Painel do SaaS): o dono envia novidades e avisos aos clientes por e-mail e/ou como aviso no painel dos clientes.
-- O banco decide o público (situação e plano), guarda um instantâneo dos destinatários e o resultado de cada envio.
-- Só tabelas e funções novas (+ uma coluna de "não receber comunicados" em org_internal). Reversão no fim do arquivo.

alter table public.org_internal add column broadcast_opt_out boolean not null default false;

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  subject text not null check (length(trim(subject)) between 3 and 150),
  body text not null check (length(trim(body)) between 3 and 5000),
  send_email boolean not null default true,
  show_in_app boolean not null default false,
  in_app_until timestamptz,
  audience jsonb not null default '{}'::jsonb,           -- { statuses: [...], plans: [...] } no momento do envio
  status text not null default 'enviando' check (status in ('enviando', 'enviada')),
  orgs_count int not null default 0,
  emails_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create table public.broadcast_orgs (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  primary key (broadcast_id, org_id)
);
create table public.broadcast_recipients (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'falhou')),
  error text,
  sent_at timestamptz,
  primary key (broadcast_id, email)
);
create table public.broadcast_dismissals (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (broadcast_id, user_id)
);
alter table public.broadcasts enable row level security;
alter table public.broadcast_orgs enable row level security;
alter table public.broadcast_recipients enable row level security;
alter table public.broadcast_dismissals enable row level security;     -- sem políticas: só funções
revoke all on public.broadcasts, public.broadcast_orgs, public.broadcast_recipients, public.broadcast_dismissals from anon, authenticated;

-- E-mails de um grupo: administradores ativos + responsável cadastrado (válidos, sem repetir).
create function public.broadcast_org_emails(p_org uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct lower(e)), '{}') from (
    select u.email as e from public.profiles p join auth.users u on u.id = p.id where p.tenant_id = p_org and p.role = 'admin' and p.active
    union all select contact_email from public.org_internal where org_id = p_org) x
  where e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
$$;

-- Grupos do público: situação e plano escolhidos; nunca excluídos nem quem pediu para não receber.
create function public.broadcast_audience_orgs(p_statuses text[], p_plans text[]) returns setof uuid
language sql stable security definer set search_path = public as $$
  select o.id from public.organizations o
  join public.plans pl on pl.id = o.plan_id
  left join public.org_internal i on i.org_id = o.id
  where o.status = any (coalesce(p_statuses, '{}')) and o.status <> 'excluida'
    and (p_plans is null or cardinality(p_plans) = 0 or pl.code = any (p_plans))
    and coalesce(i.broadcast_opt_out, false) = false
$$;

-- Prévia: quantos grupos e e-mails receberiam.
create function public.sa_broadcast_preview(p_statuses text[], p_plans text[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o int; e int;
begin
  perform public.sa_guard();
  select count(*), coalesce(sum(cardinality(public.broadcast_org_emails(id))), 0) into o, e from public.broadcast_audience_orgs(p_statuses, p_plans) id;
  return jsonb_build_object('orgs', o, 'emails', e);
end $$;

-- Cria o comunicado, guarda o instantâneo do público e já libera o aviso no painel (se escolhido). O envio de e-mails é feito em lotes pelo servidor.
create function public.sa_broadcast_send(p_subject text, p_body text, p_email boolean, p_in_app boolean, p_statuses text[], p_plans text[], p_in_app_days int default 14) returns uuid
language plpgsql security definer set search_path = public as $$
declare bid uuid; o int := 0; e int := 0; r record; m text; seen text[] := '{}';
begin
  perform public.sa_guard();
  if not coalesce(p_email, false) and not coalesce(p_in_app, false) then raise exception 'Escolha pelo menos um canal: e-mail ou aviso no painel'; end if;
  if coalesce(cardinality(p_statuses), 0) = 0 then raise exception 'Escolha para quais situações enviar'; end if;
  if exists (select 1 from unnest(p_statuses) s where s not in ('teste', 'ativa', 'suspensa', 'cancelada')) then raise exception 'Situação inválida'; end if;
  if p_in_app_days is null or p_in_app_days < 1 or p_in_app_days > 90 then raise exception 'O aviso no painel dura de 1 a 90 dias'; end if;
  insert into public.broadcasts (created_by, subject, body, send_email, show_in_app, in_app_until, audience, status)
  values (auth.uid(), trim(p_subject), trim(p_body), coalesce(p_email, false), coalesce(p_in_app, false),
          case when p_in_app then now() + make_interval(days => p_in_app_days) end,
          jsonb_build_object('statuses', p_statuses, 'plans', coalesce(p_plans, '{}')), case when p_email then 'enviando' else 'enviada' end)
  returning id into bid;
  for r in select id from public.broadcast_audience_orgs(p_statuses, p_plans) id loop
    o := o + 1;
    insert into public.broadcast_orgs (broadcast_id, org_id) values (bid, r.id);
    if p_email then
      foreach m in array public.broadcast_org_emails(r.id) loop
        if not (m = any (seen)) then
          seen := seen || m;
          insert into public.broadcast_recipients (broadcast_id, org_id, email) values (bid, r.id, m);
          e := e + 1;
        end if;
      end loop;
    end if;
  end loop;
  if o = 0 then raise exception 'Nenhum cliente corresponde ao público escolhido'; end if;
  update public.broadcasts set orgs_count = o, emails_count = e, finished_at = case when p_email then null else now() end where id = bid;
  return bid;
end $$;

-- Lista e detalhe (painel do dono).
create function public.sa_broadcasts()
returns table (id uuid, subject text, send_email boolean, show_in_app boolean, in_app_until timestamptz, status text, orgs_count int, emails_count int, sent_count int, failed_count int, created_at timestamptz, finished_at timestamptz, audience jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sa_guard();
  return query select b.id, b.subject, b.send_email, b.show_in_app, b.in_app_until, b.status, b.orgs_count, b.emails_count,
    (select count(*)::int from public.broadcast_recipients r where r.broadcast_id = b.id and r.status = 'enviado'),
    (select count(*)::int from public.broadcast_recipients r where r.broadcast_id = b.id and r.status = 'falhou'),
    b.created_at, b.finished_at, b.audience
  from public.broadcasts b order by b.created_at desc limit 50;
end $$;

create function public.sa_broadcast_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.sa_guard();
  select jsonb_build_object('broadcast', to_jsonb(b),
    'recipients', coalesce((select jsonb_agg(jsonb_build_object('email', x.email, 'org', o.name, 'status', x.status, 'error', x.error, 'sent_at', x.sent_at) order by x.status desc, o.name)
                            from public.broadcast_recipients x join public.organizations o on o.id = x.org_id where x.broadcast_id = b.id), '[]'::jsonb),
    'dismissed', (select count(*) from public.broadcast_dismissals d where d.broadcast_id = b.id))
  into r from public.broadcasts b where b.id = p_id;
  if r is null then raise exception 'Comunicado não encontrado'; end if;
  return r;
end $$;

-- "Não receber comunicados" por cliente (pedido do cliente).
create function public.sa_set_broadcast_opt_out(p_org uuid, p_opt_out boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sa_guard();
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'Grupo não encontrado'; end if;
  insert into public.org_internal (org_id, broadcast_opt_out) values (p_org, coalesce(p_opt_out, false))
    on conflict (org_id) do update set broadcast_opt_out = excluded.broadcast_opt_out, updated_at = now();
  perform public.sa_log(p_org, 'SA_BROADCAST_OPT_OUT', jsonb_build_object('opt_out', coalesce(p_opt_out, false)));
end $$;

-- ── Funções do servidor (rota de envio, com a chave de serviço, depois de validar que quem chamou é o dono) ──
create function public.broadcast_next(p_id uuid, p_limit int default 20) returns table (email text, org_id uuid)
language sql stable security definer set search_path = public as $$
  select r.email, r.org_id from public.broadcast_recipients r where r.broadcast_id = p_id and r.status = 'pendente' order by r.email limit greatest(least(p_limit, 50), 1)
$$;
create function public.broadcast_mark(p_id uuid, p_email text, p_status text, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.broadcast_recipients set status = p_status, error = left(p_error, 300), sent_at = case when p_status = 'enviado' then now() end
  where broadcast_id = p_id and email = p_email and p_status in ('enviado', 'falhou')
$$;
-- Fecha o envio quando não há mais pendentes e devolve o resumo (também serve de contagem durante o envio).
create function public.broadcast_progress(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pend int; ok_ int; bad int;
begin
  select count(*) filter (where status = 'pendente'), count(*) filter (where status = 'enviado'), count(*) filter (where status = 'falhou') into pend, ok_, bad
  from public.broadcast_recipients where broadcast_id = p_id;
  if pend = 0 then update public.broadcasts set status = 'enviada', finished_at = coalesce(finished_at, now()) where id = p_id and status = 'enviando'; end if;
  return jsonb_build_object('pending', pend, 'sent', ok_, 'failed', bad);
end $$;
create function public.broadcast_content(p_id uuid) returns table (subject text, body text, send_email boolean)
language sql stable security definer set search_path = public as $$ select subject, body, send_email from public.broadcasts where id = p_id $$;
-- Recoloca os que falharam na fila.
create function public.sa_broadcast_retry(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.sa_guard();
  update public.broadcast_recipients set status = 'pendente', error = null where broadcast_id = p_id and status = 'falhou';
  get diagnostics n = row_count;
  if n > 0 then update public.broadcasts set status = 'enviando', finished_at = null where id = p_id; end if;
  return n;
end $$;

-- ── Avisos no painel do cliente (administrador e diretoria do grupo) ──
create function public.my_announcements() returns table (id uuid, subject text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.subject, b.body, b.created_at
  from public.broadcasts b
  join public.broadcast_orgs bo on bo.broadcast_id = b.id and bo.org_id = public.current_tenant()
  where b.show_in_app and b.in_app_until > now()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role in ('admin', 'diretoria'))
    and not exists (select 1 from public.broadcast_dismissals d where d.broadcast_id = b.id and d.user_id = auth.uid())
  order by b.created_at desc limit 3
$$;
create function public.dismiss_announcement(p_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.broadcast_dismissals (broadcast_id, user_id) select p_id, auth.uid() where auth.uid() is not null
  on conflict do nothing
$$;

revoke execute on function public.broadcast_org_emails(uuid), public.broadcast_audience_orgs(text[], text[]), public.sa_broadcast_preview(text[], text[]),
  public.sa_broadcast_send(text, text, boolean, boolean, text[], text[], int), public.sa_broadcasts(), public.sa_broadcast_detail(uuid),
  public.sa_set_broadcast_opt_out(uuid, boolean), public.broadcast_next(uuid, int), public.broadcast_mark(uuid, text, text, text),
  public.broadcast_progress(uuid), public.broadcast_content(uuid), public.sa_broadcast_retry(uuid), public.my_announcements(), public.dismiss_announcement(uuid)
  from public, anon, authenticated;
grant execute on function public.sa_broadcast_preview(text[], text[]), public.sa_broadcast_send(text, text, boolean, boolean, text[], text[], int),
  public.sa_broadcasts(), public.sa_broadcast_detail(uuid), public.sa_set_broadcast_opt_out(uuid, boolean), public.sa_broadcast_retry(uuid),
  public.my_announcements(), public.dismiss_announcement(uuid) to authenticated;
grant execute on function public.broadcast_next(uuid, int), public.broadcast_mark(uuid, text, text, text), public.broadcast_progress(uuid), public.broadcast_content(uuid) to service_role;

-- Detalhe do cliente passa a informar se ele pediu para não receber comunicados.
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
              'broadcast_opt_out', coalesce(i.broadcast_opt_out, false), 'status_reason', i.status_reason, 'suspended_at', i.suspended_at, 'suspended_by', (select u.email from auth.users u where u.id = i.suspended_by),
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

-- Reversão:
--   (recriar sa_org_detail com a definição da 0027)
--   drop function public.broadcast_org_emails(uuid), public.broadcast_audience_orgs(text[], text[]), public.sa_broadcast_preview(text[], text[]),
--     public.sa_broadcast_send(text, text, boolean, boolean, text[], text[], int), public.sa_broadcasts(), public.sa_broadcast_detail(uuid),
--     public.sa_set_broadcast_opt_out(uuid, boolean), public.broadcast_next(uuid, int), public.broadcast_mark(uuid, text, text, text),
--     public.broadcast_progress(uuid), public.broadcast_content(uuid), public.sa_broadcast_retry(uuid), public.my_announcements(), public.dismiss_announcement(uuid);
--   drop table public.broadcast_dismissals, public.broadcast_recipients, public.broadcast_orgs, public.broadcasts;
--   alter table public.org_internal drop column broadcast_opt_out;
