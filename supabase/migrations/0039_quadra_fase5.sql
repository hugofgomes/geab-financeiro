-- Quadra Esportiva, Fase 5: dashboard e relatórios (ocupação, financeiro, clientes), calculados no servidor a partir dos dados reais.
-- Só funções de leitura (nenhuma tabela nova). Respeitam o estabelecimento e o perfil da sessão. Reversão no fim do arquivo.

-- Apoio: por dia e quadra, minutos abertos, ocupados e bloqueados (datas locais do centro). Interna: sem permissão de execução direta.
create function public.court_occupancy_days(p_tenant uuid, p_from date, p_to date) returns table (day date, court_id uuid, open_min int, booked_min int, blocked_min int)
language plpgsql stable security definer set search_path = public as $$
declare tz text;
begin
  select v.timezone into tz from public.court_venues v where v.tenant_id = p_tenant;
  if tz is null then return; end if;
  if p_to < p_from then raise exception 'Período inválido'; end if;
  if p_to - p_from > 400 then raise exception 'Período máximo de 13 meses'; end if;
  return query
  select d.day, c.id,
    coalesce((select sum(h.closes_min - h.opens_min)::int from public.court_hours h where h.tenant_id = p_tenant and h.active and h.weekday = extract(dow from d.day)::int
              and ((exists (select 1 from public.court_hours o where o.tenant_id = p_tenant and o.court_id = c.id and o.active) and h.court_id = c.id)
                   or (not exists (select 1 from public.court_hours o where o.tenant_id = p_tenant and o.court_id = c.id and o.active) and h.court_id is null))), 0),
    coalesce((select sum(extract(epoch from (b.ends_at - b.starts_at)) / 60)::int from public.court_bookings b where b.court_id = c.id and b.kind <> 'bloqueio' and b.status <> 'cancelada'
              and (b.starts_at at time zone tz)::date = d.day), 0),
    coalesce((select sum(extract(epoch from (b.ends_at - b.starts_at)) / 60)::int from public.court_bookings b where b.court_id = c.id and b.kind = 'bloqueio' and b.status <> 'cancelada'
              and (b.starts_at at time zone tz)::date = d.day), 0)
  from generate_series(p_from, p_to, interval '1 day') g(dd)
  cross join lateral (select g.dd::date as day) d
  cross join public.court_courts c where c.tenant_id = p_tenant and c.active;
end $$;
revoke execute on function public.court_occupancy_days(uuid, date, date) from public, anon, authenticated;

create function public.court_dashboard(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare role text := public.court_require(array['admin', 'gerente', 'recepcionista', 'financeiro']); t uuid := public.current_tenant(); tz text; today date; wk date; mo date; res jsonb; fin boolean := role in ('admin', 'gerente', 'financeiro'); ops boolean := role in ('admin', 'gerente', 'recepcionista');
begin
  select v.timezone into tz from public.court_venues v where v.tenant_id = t;
  if tz is null then return null; end if;
  today := (now() at time zone tz)::date; wk := today - extract(dow from today)::int; mo := date_trunc('month', today)::date;
  select jsonb_build_object(
    'courts_total', (select count(*) from public.court_courts where tenant_id = t),
    'courts_active', (select count(*) from public.court_courts where tenant_id = t and active),
    'bookings_today', (select count(*) from public.court_bookings b where b.tenant_id = t and b.kind <> 'bloqueio' and b.status <> 'cancelada' and (b.starts_at at time zone tz)::date = today),
    'bookings_week', (select count(*) from public.court_bookings b where b.tenant_id = t and b.kind <> 'bloqueio' and b.status <> 'cancelada' and (b.starts_at at time zone tz)::date between wk and wk + 6),
    'bookings_month', (select count(*) from public.court_bookings b where b.tenant_id = t and b.kind <> 'bloqueio' and b.status <> 'cancelada' and (b.starts_at at time zone tz)::date >= mo and (b.starts_at at time zone tz)::date < (mo + interval '1 month')::date),
    'free_minutes_today', (select coalesce(sum(greatest(open_min - booked_min - blocked_min, 0)), 0) from public.court_occupancy_days(t, today, today)),
    'free_by_court_today', coalesce((select jsonb_agg(jsonb_build_object('court', c.name, 'free_min', greatest(o.open_min - o.booked_min - o.blocked_min, 0)) order by c.name)
        from public.court_occupancy_days(t, today, today) o join public.court_courts c on c.id = o.court_id), '[]'),
    'occupancy', (select jsonb_build_object('open_min', coalesce(sum(open_min - least(blocked_min, open_min)), 0), 'booked_min', coalesce(sum(booked_min), 0)) from public.court_occupancy_days(t, p_from, p_to)),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'open_min', om, 'booked_min', bm) order by day) from
        (select day, sum(open_min - least(blocked_min, open_min))::int om, sum(booked_min)::int bm from public.court_occupancy_days(t, p_from, p_to) group by day) x), '[]'),
    'by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'n', n)) from (select b.kind, count(*) n from public.court_bookings b where b.tenant_id = t and b.status <> 'cancelada'
        and (b.starts_at at time zone tz)::date between p_from and p_to group by b.kind) x), '[]'),
    'peak_hours', coalesce((select jsonb_agg(jsonb_build_object('hour', h, 'n', n) order by h) from (select extract(hour from b.starts_at at time zone tz)::int h, count(*) n from public.court_bookings b
        where b.tenant_id = t and b.kind <> 'bloqueio' and b.status <> 'cancelada' and (b.starts_at at time zone tz)::date between p_from and p_to group by 1) x), '[]'),
    'done_vs_cancelled', (select jsonb_build_object('done', count(*) filter (where b.status in ('pendente', 'confirmada', 'concluida', 'nao_compareceu')), 'cancelled', count(*) filter (where b.status = 'cancelada'))
        from public.court_bookings b where b.tenant_id = t and b.kind <> 'bloqueio' and (b.starts_at at time zone tz)::date between p_from and p_to),
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'bookings', (select count(*) from public.court_bookings b where b.tenant_id = t and b.kind <> 'bloqueio' and b.status <> 'cancelada'
        and date_trunc('month', b.starts_at at time zone tz)::date = m),
        'received', case when fin then (select coalesce(sum(p.amount_cents), 0) from public.court_payments p where p.tenant_id = t and date_trunc('month', p.paid_on)::date = m) else null end) order by m)
        from (select (mo - (i || ' months')::interval)::date m from generate_series(0, 5) i) ms), '[]'),
    'upcoming', coalesce((select jsonb_agg(to_jsonb(x)) from (select b.code, b.client_name, c.name court, b.starts_at, b.ends_at, b.status, b.kind from public.court_bookings b join public.court_courts c on c.id = b.court_id
        where b.tenant_id = t and b.kind <> 'bloqueio' and b.status in ('pendente', 'confirmada') and b.starts_at >= now() order by b.starts_at limit 8) x), '[]'),
    'pending', coalesce((select jsonb_agg(to_jsonb(x)) from (select b.code, b.client_name, c.name court, b.starts_at, b.ends_at from public.court_bookings b join public.court_courts c on c.id = b.court_id
        where b.tenant_id = t and b.kind <> 'bloqueio' and b.status = 'pendente' and b.starts_at >= now() order by b.starts_at limit 10) x), '[]'),
    'pending_total', (select count(*) from public.court_bookings b where b.tenant_id = t and b.kind <> 'bloqueio' and b.status = 'pendente' and b.starts_at >= now()),
    'clients_active', (select count(*) from public.court_clients where tenant_id = t and status = 'ativo'),
    'monthly_clients_active', (select count(*) from public.court_clients where tenant_id = t and status = 'ativo' and client_type = 'mensalista'),
    'waitlist', case when ops then (select count(*) from public.court_waitlist where tenant_id = t and status = 'aguardando') else null end,
    'birthdays', case when ops then coalesce((select jsonb_agg(jsonb_build_object('name', name, 'day', extract(day from birth_date)::int) order by extract(day from birth_date)) from public.court_clients
        where tenant_id = t and status = 'ativo' and birthday_consent and birth_date is not null and extract(month from birth_date) = extract(month from today)), '[]') else null end,
    'revenue_month', case when fin then (select coalesce(sum(amount_cents), 0) from public.court_payments where tenant_id = t and paid_on >= mo and paid_on < (mo + interval '1 month')::date) else null end,
    'to_receive', case when fin then (select coalesce(sum(amount_cents - paid_cents), 0) from public.court_receivables where tenant_id = t and status in ('aberto', 'parcial')) else null end,
    'overdue', case when fin then (select coalesce(sum(amount_cents - paid_cents), 0) from public.court_receivables where tenant_id = t and status in ('aberto', 'parcial') and due_on < today) else null end,
    'no_hours', not exists (select 1 from public.court_hours where tenant_id = t and active)
  ) into res;
  return res;
end $$;

-- Ocupação: por quadra, dia da semana, faixa de horário, modalidade e categoria.
create function public.court_report_occupancy(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_tenant(); tz text; res jsonb;
begin
  perform public.court_require(array['admin', 'gerente']);
  select v.timezone into tz from public.court_venues v where v.tenant_id = t;
  if tz is null then return null; end if;
  select jsonb_build_object(
    'by_court', coalesce((select jsonb_agg(jsonb_build_object('court', c.name, 'open_min', x.om, 'booked_min', x.bm, 'blocked_min', x.blk) order by c.name) from
        (select court_id, sum(open_min - least(blocked_min, open_min))::int om, sum(booked_min)::int bm, sum(blocked_min)::int blk from public.court_occupancy_days(t, p_from, p_to) group by court_id) x
        join public.court_courts c on c.id = x.court_id), '[]'),
    'by_weekday', coalesce((select jsonb_agg(jsonb_build_object('weekday', w, 'open_min', om, 'booked_min', bm) order by w) from
        (select extract(dow from day)::int w, sum(open_min - least(blocked_min, open_min))::int om, sum(booked_min)::int bm from public.court_occupancy_days(t, p_from, p_to) group by 1) x), '[]'),
    'by_hour', coalesce((select jsonb_agg(jsonb_build_object('hour', h, 'n', n, 'minutes', mins) order by h) from (select extract(hour from b.starts_at at time zone tz)::int h, count(*) n,
        sum(extract(epoch from (b.ends_at - b.starts_at)) / 60)::int mins from public.court_bookings b where b.tenant_id = t and b.kind <> 'bloqueio' and b.status <> 'cancelada'
        and (b.starts_at at time zone tz)::date between p_from and p_to group by 1) x), '[]'),
    'by_sport', coalesce((select jsonb_agg(jsonb_build_object('sport', s, 'n', n)) from (select coalesce(b.sport, 'outra') s, count(*) n from public.court_bookings b where b.tenant_id = t and b.kind <> 'bloqueio'
        and b.status <> 'cancelada' and (b.starts_at at time zone tz)::date between p_from and p_to group by 1 order by 2 desc) x), '[]'),
    'by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', k, 'n', n)) from (select b.kind k, count(*) n from public.court_bookings b where b.tenant_id = t and b.status <> 'cancelada'
        and (b.starts_at at time zone tz)::date between p_from and p_to group by 1 order by 2 desc) x), '[]')
  ) into res;
  return res;
end $$;

-- Financeiro: receita por mês, comparativo com o período anterior de mesma duração, pendente e inadimplência.
create function public.court_report_finance(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_tenant(); tz text; today date; len int := p_to - p_from + 1; res jsonb;
begin
  perform public.court_require(array['admin', 'gerente', 'financeiro']);
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Período inválido (máximo de 13 meses)'; end if;
  select coalesce((select v.timezone from public.court_venues v where v.tenant_id = t), 'America/Sao_Paulo') into tz;
  today := (now() at time zone tz)::date;
  select jsonb_build_object(
    'received', (select coalesce(sum(amount_cents), 0) from public.court_payments where tenant_id = t and paid_on between p_from and p_to),
    'received_prev', (select coalesce(sum(amount_cents), 0) from public.court_payments where tenant_id = t and paid_on between p_from - len and p_from - 1),
    'billed', (select coalesce(sum(amount_cents), 0) from public.court_receivables where tenant_id = t and status <> 'cancelado' and due_on between p_from and p_to),
    'pending', (select coalesce(sum(amount_cents - paid_cents), 0) from public.court_receivables where tenant_id = t and status in ('aberto', 'parcial') and due_on >= today),
    'overdue', (select coalesce(sum(amount_cents - paid_cents), 0) from public.court_receivables where tenant_id = t and status in ('aberto', 'parcial') and due_on < today),
    'overdue_clients', coalesce((select jsonb_agg(jsonb_build_object('client', client_name, 'cents', cents, 'n', n)) from (select client_name, sum(amount_cents - paid_cents)::bigint cents, count(*) n
        from public.court_receivables where tenant_id = t and status in ('aberto', 'parcial') and due_on < today group by client_name order by 2 desc limit 20) x), '[]'),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'cents', c) order by m) from (select date_trunc('month', paid_on)::date m, sum(amount_cents)::bigint c from public.court_payments
        where tenant_id = t and paid_on between p_from and p_to group by 1) x), '[]'),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'cents', c)) from (select method, sum(amount_cents)::bigint c from public.court_payments where tenant_id = t
        and paid_on between p_from and p_to group by 1 order by 2 desc) x), '[]'),
    'summary', public.court_finance_summary(p_from, p_to)
  ) into res;
  return res;
end $$;

-- Clientes: novos, ativos no período (com reserva), mensalistas, frequência e recorrentes.
create function public.court_report_clients(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_tenant(); tz text; res jsonb;
begin
  perform public.court_require(array['admin', 'gerente']);
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Período inválido (máximo de 13 meses)'; end if;
  select coalesce((select v.timezone from public.court_venues v where v.tenant_id = t), 'America/Sao_Paulo') into tz;
  select jsonb_build_object(
    'new_clients', (select count(*) from public.court_clients where tenant_id = t and (created_at at time zone tz)::date between p_from and p_to),
    'registered_active', (select count(*) from public.court_clients where tenant_id = t and status = 'ativo'),
    'active_in_period', (select count(distinct client_id) from public.court_bookings b where b.tenant_id = t and b.client_id is not null and b.kind <> 'bloqueio' and b.status in ('confirmada', 'concluida')
        and (b.starts_at at time zone tz)::date between p_from and p_to),
    'monthly_clients', (select count(*) from public.court_clients where tenant_id = t and status = 'ativo' and client_type = 'mensalista'),
    'recurrent', (select count(*) from (select client_id from public.court_bookings b where b.tenant_id = t and b.client_id is not null and b.kind <> 'bloqueio' and b.status in ('confirmada', 'concluida')
        and (b.starts_at at time zone tz)::date between p_from and p_to group by client_id having count(*) >= 4) x),
    'top', coalesce((select jsonb_agg(jsonb_build_object('client', name, 'type', client_type, 'n', n, 'cents', cents) order by n desc) from (select c.name, c.client_type, count(*) n, sum(b.price_cents)::bigint cents
        from public.court_bookings b join public.court_clients c on c.id = b.client_id where b.tenant_id = t and b.kind <> 'bloqueio' and b.status in ('confirmada', 'concluida')
        and (b.starts_at at time zone tz)::date between p_from and p_to group by c.id, c.name, c.client_type order by 3 desc limit 20) x), '[]'),
    'by_type', coalesce((select jsonb_agg(jsonb_build_object('type', client_type, 'n', n)) from (select client_type, count(*) n from public.court_clients where tenant_id = t and status = 'ativo' group by 1) x), '[]'),
    'unlinked_bookings', (select count(*) from public.court_bookings b where b.tenant_id = t and b.client_id is null and b.kind <> 'bloqueio' and b.status <> 'cancelada' and (b.starts_at at time zone tz)::date between p_from and p_to)
  ) into res;
  return res;
end $$;

do $$
declare f text;
begin
  foreach f in array array['court_dashboard(date, date)', 'court_report_occupancy(date, date)', 'court_report_finance(date, date)', 'court_report_clients(date, date)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Reversão:
--   drop function public.court_report_clients(date, date), public.court_report_finance(date, date), public.court_report_occupancy(date, date), public.court_dashboard(date, date), public.court_occupancy_days(uuid, date, date);
