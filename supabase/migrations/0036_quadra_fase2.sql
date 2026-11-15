-- Quadra Esportiva, Fase 2: agenda e reservas.
-- Reservas e bloqueios ficam na MESMA tabela, com restrição de exclusão no banco: duas reservas ativas nunca se sobrepõem na mesma quadra
-- (reserva cancelada não bloqueia; horários colados são permitidos). Toda escrita de reservas passa por funções transacionais que validam
-- permissão, horário de funcionamento, duração, preço e conflito NO SERVIDOR. Só adiciona. Reversão no fim do arquivo.

-- Extensão que permite a restrição de exclusão por quadra + período (no Supabase vive no schema "extensions").
do $$
begin
  if exists (select 1 from pg_extension where extname = 'btree_gist') then null;
  elsif exists (select 1 from information_schema.schemata where schema_name = 'extensions') then execute 'create extension btree_gist with schema extensions';
  else execute 'create extension btree_gist';
  end if;
end $$;

-- ───────── Regras do centro (agenda) ─────────
alter table public.court_venues
  add column slot_minutes smallint not null default 60 check (slot_minutes in (30, 60)),
  add column min_duration_minutes smallint not null default 60 check (min_duration_minutes between 30 and 720),
  add column min_notice_minutes integer not null default 0 check (min_notice_minutes between 0 and 43200),       -- antecedência mínima (reserva pública, Fase 6)
  add column max_advance_days smallint not null default 90 check (max_advance_days between 1 and 730),           -- antecedência máxima (reserva pública, Fase 6)
  add column cancel_free_hours smallint not null default 24 check (cancel_free_hours between 0 and 720),         -- cancelar com menos que isto = cancelamento tardio
  add column cancel_fee_pct smallint not null default 0 check (cancel_fee_pct between 0 and 100);                -- cobrança sobre cancelamento tardio (aplicada na Fase 4)

-- ───────── Funcionamento e preços ─────────
create table public.court_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.resolve_tenant() references public.organizations(id),
  court_id uuid references public.court_courts(id) on delete cascade,          -- nulo = padrão do centro; com linhas próprias, a quadra ignora o padrão
  weekday smallint not null check (weekday between 0 and 6),                   -- 0 = domingo
  opens_min smallint not null check (opens_min between 0 and 1439),
  closes_min smallint not null check (closes_min between 1 and 1440),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (closes_min > opens_min)
);
create index court_hours_tenant_idx on public.court_hours (tenant_id, weekday);

create table public.court_price_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.resolve_tenant() references public.organizations(id),
  court_id uuid references public.court_courts(id) on delete cascade,          -- nulo = vale para todas as quadras
  name text not null check (length(trim(name)) between 2 and 60),
  weekdays smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  from_min smallint not null check (from_min between 0 and 1439),
  to_min smallint not null check (to_min between 1 and 1440),
  kind text check (kind is null or kind in ('avulsa', 'mensalista', 'mensalista_professor')),   -- nulo = qualquer tipo
  price_cents integer not null check (price_cents between 0 and 1000000),       -- valor POR HORA
  priority smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (to_min > from_min)
);
create index court_price_rules_tenant_idx on public.court_price_rules (tenant_id);

create function public.court_hours_validate() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from public.court_hours h where h.tenant_id = new.tenant_id and h.weekday = new.weekday and h.court_id is not distinct from new.court_id
             and h.id is distinct from new.id and h.active and new.active and h.opens_min < new.closes_min and new.opens_min < h.closes_min) then
    raise exception 'Este horário se sobrepõe a outro já cadastrado no mesmo dia';
  end if;
  return new;
end $$;

-- ───────── Séries (recorrência) e reservas ─────────
create table public.court_series (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.resolve_tenant() references public.organizations(id),
  court_id uuid not null references public.court_courts(id),
  kind text not null check (kind in ('avulsa', 'mensalista', 'mensalista_professor')),
  client_name text not null check (length(trim(client_name)) between 2 and 120),
  client_phone text check (client_phone is null or client_phone ~ '^[0-9]{10,15}$'),
  sport text,
  frequency text not null check (frequency in ('semanal', 'quinzenal', 'mensal')),
  first_date date not null,
  start_min smallint not null check (start_min between 0 and 1439),
  duration_min smallint not null check (duration_min between 15 and 1440),
  until_date date,
  occurrences smallint check (occurrences is null or occurrences between 1 and 104),
  price_cents integer not null default 0 check (price_cents >= 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index court_series_tenant_idx on public.court_series (tenant_id);

create table public.court_counters (
  tenant_id uuid primary key references public.organizations(id),
  bookings integer not null default 0
);

create table public.court_bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.resolve_tenant() references public.organizations(id),
  court_id uuid not null references public.court_courts(id),
  code text not null,
  kind text not null check (kind in ('avulsa', 'mensalista', 'mensalista_professor', 'bloqueio')),
  block_reason text check (block_reason is null or block_reason in ('manutencao', 'torneio', 'outro')),
  client_name text check (client_name is null or length(trim(client_name)) between 2 and 120),
  client_phone text check (client_phone is null or client_phone ~ '^[0-9]{10,15}$'),
  sport text check (sport is null or sport in ('futebol_society', 'futsal', 'futebol_campo', 'volei', 'volei_praia', 'beach_tennis', 'basquete', 'tenis', 'padel', 'outra')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_cents integer not null default 0 check (price_cents between 0 and 10000000),
  payment_method text check (payment_method is null or payment_method in ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'transferencia', 'outro')),
  payment_status text not null default 'em_aberto' check (payment_status in ('em_aberto', 'parcial', 'pago')),
  status text not null default 'confirmada' check (status in ('pendente', 'confirmada', 'concluida', 'cancelada', 'nao_compareceu')),
  notes text check (notes is null or length(notes) <= 500),
  series_id uuid references public.court_series(id) on delete set null,
  occurrence_no smallint,
  late_cancel boolean not null default false,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((kind = 'bloqueio') = (block_reason is not null)),
  check (kind <> 'bloqueio' or status in ('confirmada', 'cancelada')),
  check (kind = 'bloqueio' or client_name is not null),
  unique (tenant_id, code),
  -- FONTE ÚNICA DE VERDADE DA DISPONIBILIDADE: nenhuma sobreposição ativa na mesma quadra.
  constraint court_bookings_no_overlap exclude using gist (court_id with =, tstzrange(starts_at, ends_at, '[)') with &&) where (status <> 'cancelada')
);
create index court_bookings_tenant_start_idx on public.court_bookings (tenant_id, starts_at);
create index court_bookings_court_start_idx on public.court_bookings (court_id, starts_at);
create index court_bookings_series_idx on public.court_bookings (series_id) where series_id is not null;

create function public.court_booking_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ───────── Proteções, auditoria e acesso ─────────
do $$
declare t text;
begin
  foreach t in array array['court_hours', 'court_price_rules', 'court_series', 'court_counters', 'court_bookings']
  loop
    execute format('create trigger a_support_readonly before insert or update or delete on public.%I for each row execute function public.block_support_writes()', t);
    execute format('create trigger a_tenant_guard before insert or update or delete on public.%I for each row execute function public.tenant_guard()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  foreach t in array array['court_hours', 'court_price_rules', 'court_series', 'court_bookings']
  loop
    execute format('create trigger z_audit after insert or update or delete on public.%I for each row execute function public.audit()', t);
  end loop;
end $$;
create trigger b_tenant_refs before insert or update on public.court_hours for each row execute function public.tenant_ref_check('court_id:court_courts');
create trigger b_tenant_refs before insert or update on public.court_price_rules for each row execute function public.tenant_ref_check('court_id:court_courts');
create trigger b_tenant_refs before insert or update on public.court_series for each row execute function public.tenant_ref_check('court_id:court_courts');
create trigger b_tenant_refs before insert or update on public.court_bookings for each row execute function public.tenant_ref_check('court_id:court_courts', 'series_id:court_series');
create trigger c_validate before insert or update on public.court_hours for each row execute function public.court_hours_validate();
create trigger c_touch before update on public.court_bookings for each row execute function public.court_booking_touch();

-- Horários e preços: só o administrador altera (leitura para quem tem perfil no módulo).
grant select, insert, update, delete on public.court_hours, public.court_price_rules to authenticated;
create policy court_hours_read on public.court_hours for select using (public.court_role() is not null and tenant_id = public.current_tenant());
create policy court_hours_write on public.court_hours for all using (public.court_role() = 'admin' and tenant_id = public.current_tenant()) with check (public.court_role() = 'admin' and tenant_id = public.current_tenant());
create policy court_price_rules_read on public.court_price_rules for select using (public.court_role() is not null and tenant_id = public.current_tenant());
create policy court_price_rules_write on public.court_price_rules for all using (public.court_role() = 'admin' and tenant_id = public.current_tenant()) with check (public.court_role() = 'admin' and tenant_id = public.current_tenant());
-- Reservas e séries: leitura direta; ESCRITA SOMENTE pelas funções abaixo (o Supabase concede privilégios amplos por padrão: retiramos).
revoke all on public.court_series, public.court_bookings, public.court_counters from authenticated;
grant select on public.court_series, public.court_bookings to authenticated;
create policy court_series_read on public.court_series for select using (public.court_role() is not null and tenant_id = public.current_tenant());
create policy court_bookings_read on public.court_bookings for select using (public.court_role() is not null and tenant_id = public.current_tenant());

-- ───────── Funções de apoio ─────────
create function public.court_require(p_roles text[]) returns text
language plpgsql stable security definer set search_path = public as $$
declare r text := public.court_role();
begin
  if r is null or not (r = any (p_roles)) then raise exception 'Você não tem permissão para esta ação'; end if;
  return r;
end $$;

create function public.court_local_minutes(ts timestamptz, tz text) returns int
language sql immutable as $$ select (extract(hour from ts at time zone tz) * 60 + extract(minute from ts at time zone tz))::int $$;
create function public.court_local_dow(ts timestamptz, tz text) returns int
language sql immutable as $$ select extract(dow from ts at time zone tz)::int $$;

create function public.court_next_code(p_tenant uuid) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.court_counters (tenant_id, bookings) values (p_tenant, 1)
  on conflict (tenant_id) do update set bookings = public.court_counters.bookings + 1 returning bookings into n;
  return 'R-' || lpad(n::text, 6, '0');
end $$;

-- Descrição do conflito (para a mensagem de erro).
create function public.court_conflict_info(p_tenant uuid, p_court uuid, p_start timestamptz, p_end timestamptz, p_ignore uuid default null) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select case when b.kind = 'bloqueio' then 'bloqueio (' || b.block_reason || ')' else b.code || ' · ' || coalesce(b.client_name, '') end
    from public.court_bookings b where b.tenant_id = p_tenant and b.court_id = p_court and b.status <> 'cancelada' and b.id is distinct from p_ignore
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_start, p_end, '[)') order by b.starts_at limit 1), 'outra reserva')
$$;

-- Valida o horário de uma reserva (o bloqueio escapa das regras de grade e de funcionamento).
create function public.court_validate_window(p_tenant uuid, p_court uuid, p_start timestamptz, p_end timestamptz, p_kind text, p_role text) returns void
language plpgsql stable security definer set search_path = public as $$
declare v public.court_venues; c public.court_courts; dur int; sm int; dow int; own boolean; ok boolean;
begin
  select * into v from public.court_venues where tenant_id = p_tenant;
  if not found then raise exception 'Cadastre o centro esportivo antes de criar reservas'; end if;
  select * into c from public.court_courts where id = p_court and tenant_id = p_tenant;
  if not found then raise exception 'Quadra não encontrada'; end if;
  if p_end <= p_start then raise exception 'O horário final deve ser depois do inicial'; end if;
  if p_kind = 'bloqueio' then return; end if;
  if not c.active then raise exception 'Esta quadra está inativa'; end if;
  dur := (extract(epoch from (p_end - p_start)) / 60)::int;
  sm := public.court_local_minutes(p_start, v.timezone);
  if sm % v.slot_minutes <> 0 or dur % v.slot_minutes <> 0 then raise exception 'Os horários devem seguir intervalos de % minutos', v.slot_minutes; end if;
  if dur < v.min_duration_minutes then raise exception 'A duração mínima é de % minutos', v.min_duration_minutes; end if;
  if sm + dur > 1440 then raise exception 'A reserva deve terminar no mesmo dia (até a meia-noite)'; end if;
  if not exists (select 1 from public.court_hours where tenant_id = p_tenant and active) then
    raise exception 'Configure os horários de funcionamento em Configurações antes de criar reservas';
  end if;
  dow := public.court_local_dow(p_start, v.timezone);
  own := exists (select 1 from public.court_hours where tenant_id = p_tenant and court_id = p_court and active);
  select exists (select 1 from public.court_hours h where h.tenant_id = p_tenant and h.active and h.weekday = dow
                 and ((own and h.court_id = p_court) or (not own and h.court_id is null)) and h.opens_min <= sm and sm + dur <= h.closes_min) into ok;
  if not ok then raise exception 'Fora do horário de funcionamento da quadra'; end if;
  if p_start < now() and p_role not in ('admin', 'gerente') then raise exception 'Só o administrador ou o gerente podem lançar reservas no passado'; end if;
end $$;

-- Preço: soma das faixas (valor por hora) de cada intervalo da reserva; sem regra, vale o valor base da quadra.
create function public.court_price_for(p_tenant uuid, p_court uuid, p_start timestamptz, p_end timestamptz, p_kind text) returns int
language plpgsql stable security definer set search_path = public as $$
declare v public.court_venues; c public.court_courts; t timestamptz := p_start; total numeric := 0; hourly int; sm int; dow int;
begin
  select * into v from public.court_venues where tenant_id = p_tenant;
  select * into c from public.court_courts where id = p_court and tenant_id = p_tenant;
  if v.id is null or c.id is null then return 0; end if;
  while t < p_end loop
    sm := public.court_local_minutes(t, v.timezone); dow := public.court_local_dow(t, v.timezone);
    select pr.price_cents into hourly from public.court_price_rules pr
      where pr.tenant_id = p_tenant and pr.active and (pr.court_id = p_court or pr.court_id is null) and dow = any (pr.weekdays)
        and sm >= pr.from_min and sm < pr.to_min and (pr.kind is null or pr.kind = p_kind)
      order by (pr.court_id is not null) desc, (pr.kind is not null) desc, pr.priority desc, pr.price_cents limit 1;
    total := total + coalesce(hourly, c.price_cents) * v.slot_minutes / 60.0;
    t := t + make_interval(mins => v.slot_minutes);
  end loop;
  return round(total)::int;
end $$;

create function public.court_norm_phone(p text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d = '' then return null; end if;
  if length(d) between 10 and 11 then d := '55' || d; end if;
  if length(d) < 12 or length(d) > 15 then raise exception 'Telefone inválido: informe com DDD'; end if;
  return d;
end $$;

-- ───────── Reservas ─────────
create function public.court_booking_create(p_court uuid, p_kind text, p_client_name text, p_client_phone text, p_sport text, p_start timestamptz, p_end timestamptz,
  p_price_cents int default null, p_payment_method text default null, p_payment_status text default 'em_aberto', p_status text default 'confirmada', p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare role text := public.court_require(array['admin', 'gerente', 'recepcionista']); t uuid := public.current_tenant(); b public.court_bookings; price int; sp text;
begin
  if p_kind not in ('avulsa', 'mensalista', 'mensalista_professor') then raise exception 'Tipo de reserva inválido'; end if;
  if length(trim(coalesce(p_client_name, ''))) < 2 then raise exception 'Informe o nome do cliente'; end if;
  if p_status not in ('pendente', 'confirmada') then raise exception 'Uma nova reserva nasce pendente ou confirmada'; end if;
  perform public.court_validate_window(t, p_court, p_start, p_end, p_kind, role);
  price := coalesce(p_price_cents, public.court_price_for(t, p_court, p_start, p_end, p_kind));
  if price < 0 or price > 10000000 then raise exception 'Valor inválido'; end if;
  select coalesce(p_sport, c.sport) into sp from public.court_courts c where c.id = p_court;
  begin
    insert into public.court_bookings (tenant_id, court_id, code, kind, client_name, client_phone, sport, starts_at, ends_at, price_cents, payment_method, payment_status, status, notes)
    values (t, p_court, public.court_next_code(t), p_kind, trim(p_client_name), public.court_norm_phone(p_client_phone), sp, p_start, p_end, price, p_payment_method, coalesce(p_payment_status, 'em_aberto'), p_status, nullif(trim(coalesce(p_notes, '')), ''))
    returning * into b;
  exception when exclusion_violation then
    raise exception 'Horário indisponível: já existe %', public.court_conflict_info(t, p_court, p_start, p_end);
  end;
  return to_jsonb(b);
end $$;

create function public.court_block_create(p_courts uuid[], p_reason text, p_start timestamptz, p_end timestamptz, p_notes text default null) returns int
language plpgsql security definer set search_path = public as $$
declare role text := public.court_require(array['admin', 'gerente']); t uuid := public.current_tenant(); c uuid; n int := 0; nm text;
begin
  if p_reason not in ('manutencao', 'torneio', 'outro') then raise exception 'Motivo do bloqueio inválido'; end if;
  if coalesce(cardinality(p_courts), 0) = 0 then raise exception 'Escolha ao menos uma quadra'; end if;
  foreach c in array p_courts loop
    perform public.court_validate_window(t, c, p_start, p_end, 'bloqueio', role);
    begin
      insert into public.court_bookings (tenant_id, court_id, code, kind, block_reason, starts_at, ends_at, status, notes)
      values (t, c, public.court_next_code(t), 'bloqueio', p_reason, p_start, p_end, 'confirmada', nullif(trim(coalesce(p_notes, '')), ''));
      n := n + 1;
    exception when exclusion_violation then
      select name into nm from public.court_courts where id = c;
      raise exception 'Não foi possível bloquear a quadra %: já existe %. Cancele ou remarque a reserva antes.', nm, public.court_conflict_info(t, c, p_start, p_end);
    end;
  end loop;
  return n;
end $$;

create function public.court_booking_update(p_id uuid, p_patch jsonb, p_scope text default 'one') returns jsonb
language plpgsql security definer set search_path = public as $$
declare role text := public.court_require(array['admin', 'gerente', 'recepcionista']); t uuid := public.current_tenant(); b public.court_bookings; k text; ns text; n int;
  allowed text[] := array['client_name', 'client_phone', 'sport', 'price_cents', 'payment_method', 'payment_status', 'status', 'notes', 'kind'];
begin
  select * into b from public.court_bookings where id = p_id and tenant_id = t for update;
  if not found then raise exception 'Reserva não encontrada'; end if;
  if b.status = 'cancelada' then raise exception 'Uma reserva cancelada não pode ser alterada'; end if;
  if b.kind = 'bloqueio' then
    if role not in ('admin', 'gerente') then raise exception 'Você não tem permissão para esta ação'; end if;
    allowed := array['notes'];
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (allowed)) then raise exception 'Campo não permitido: %', k; end if;
  end loop;
  if p_patch ? 'kind' and p_patch->>'kind' not in ('avulsa', 'mensalista', 'mensalista_professor') then raise exception 'Tipo de reserva inválido'; end if;
  if p_patch ? 'client_name' and length(trim(coalesce(p_patch->>'client_name', ''))) < 2 then raise exception 'Informe o nome do cliente'; end if;
  if p_patch ? 'status' then
    ns := p_patch->>'status';
    if p_scope = 'future' then raise exception 'A situação da reserva é alterada uma ocorrência por vez'; end if;
    if ns not in ('pendente', 'confirmada', 'concluida', 'nao_compareceu') then raise exception 'Para cancelar use a opção Cancelar'; end if;
    if ns in ('concluida', 'nao_compareceu') and b.starts_at > now() then raise exception 'Só é possível concluir ou marcar não comparecimento depois do início'; end if;
    if b.status in ('concluida', 'nao_compareceu') and role not in ('admin', 'gerente') then raise exception 'Só o administrador ou o gerente corrigem uma reserva encerrada'; end if;
    if b.status = 'confirmada' and ns = 'pendente' then raise exception 'Uma reserva confirmada não volta para pendente'; end if;
    if b.status in ('concluida', 'nao_compareceu') and ns = 'pendente' then raise exception 'Transição de situação inválida'; end if;
  end if;
  if p_scope = 'future' and b.series_id is null then raise exception 'Esta reserva não faz parte de uma recorrência'; end if;
  update public.court_bookings x set
    client_name = case when p_patch ? 'client_name' then trim(p_patch->>'client_name') else x.client_name end,
    client_phone = case when p_patch ? 'client_phone' then public.court_norm_phone(p_patch->>'client_phone') else x.client_phone end,
    sport = case when p_patch ? 'sport' then nullif(p_patch->>'sport', '') else x.sport end,
    price_cents = case when p_patch ? 'price_cents' then (p_patch->>'price_cents')::int else x.price_cents end,
    payment_method = case when p_patch ? 'payment_method' then nullif(p_patch->>'payment_method', '') else x.payment_method end,
    payment_status = case when p_patch ? 'payment_status' then p_patch->>'payment_status' else x.payment_status end,
    status = case when p_patch ? 'status' then p_patch->>'status' else x.status end,
    notes = case when p_patch ? 'notes' then nullif(trim(coalesce(p_patch->>'notes', '')), '') else x.notes end,
    kind = case when p_patch ? 'kind' then p_patch->>'kind' else x.kind end
  where x.tenant_id = t and ((p_scope <> 'future' and x.id = p_id) or (p_scope = 'future' and x.series_id = b.series_id and x.starts_at >= b.starts_at and x.status in ('pendente', 'confirmada')));
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n, 'booking', (select to_jsonb(y) from public.court_bookings y where y.id = p_id));
end $$;

create function public.court_booking_reschedule(p_id uuid, p_court uuid, p_start timestamptz, p_end timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare role text := public.court_require(array['admin', 'gerente', 'recepcionista']); t uuid := public.current_tenant(); b public.court_bookings;
begin
  select * into b from public.court_bookings where id = p_id and tenant_id = t for update;
  if not found then raise exception 'Reserva não encontrada'; end if;
  if b.status not in ('pendente', 'confirmada') then raise exception 'Só reservas pendentes ou confirmadas podem ser remarcadas'; end if;
  if b.kind = 'bloqueio' and role not in ('admin', 'gerente') then raise exception 'Você não tem permissão para esta ação'; end if;
  perform public.court_validate_window(t, p_court, p_start, p_end, b.kind, role);
  begin
    update public.court_bookings set court_id = p_court, starts_at = p_start, ends_at = p_end where id = p_id returning * into b;
  exception when exclusion_violation then
    raise exception 'Horário indisponível: já existe %', public.court_conflict_info(t, p_court, p_start, p_end, p_id);
  end;
  return to_jsonb(b);
end $$;

create function public.court_booking_cancel(p_id uuid, p_reason text, p_scope text default 'one') returns jsonb
language plpgsql security definer set search_path = public as $$
declare role text := public.court_require(array['admin', 'gerente', 'recepcionista']); t uuid := public.current_tenant(); b public.court_bookings; v public.court_venues; n int; late boolean;
begin
  select * into b from public.court_bookings where id = p_id and tenant_id = t for update;
  if not found then raise exception 'Reserva não encontrada'; end if;
  if b.status = 'cancelada' then raise exception 'Esta reserva já está cancelada'; end if;
  if b.status in ('concluida', 'nao_compareceu') then raise exception 'Uma reserva encerrada não pode ser cancelada'; end if;
  if b.kind = 'bloqueio' and role not in ('admin', 'gerente') then raise exception 'Você não tem permissão para esta ação'; end if;
  if p_scope = 'future' and b.series_id is null then raise exception 'Esta reserva não faz parte de uma recorrência'; end if;
  select * into v from public.court_venues where tenant_id = t;
  update public.court_bookings x set status = 'cancelada', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 200),
    late_cancel = (x.kind <> 'bloqueio' and x.starts_at > now() and x.starts_at - now() < make_interval(hours => v.cancel_free_hours))
  where x.tenant_id = t and ((p_scope <> 'future' and x.id = p_id) or (p_scope = 'future' and x.series_id = b.series_id and x.starts_at >= b.starts_at and x.status in ('pendente', 'confirmada')));
  get diagnostics n = row_count;
  return jsonb_build_object('cancelled', n);
end $$;

-- ───────── Recorrência ─────────
create function public.court_series_create(p_court uuid, p_kind text, p_client_name text, p_client_phone text, p_sport text, p_first_date date, p_start_min int, p_duration_min int,
  p_frequency text, p_until date, p_count int, p_price_cents int default null, p_payment_method text default null, p_status text default 'confirmada') returns jsonb
language plpgsql security definer set search_path = public as $$
declare role text := public.court_require(array['admin', 'gerente', 'recepcionista']); t uuid := public.current_tenant(); v public.court_venues; sid uuid; d date := p_first_date; n int := 0; made int := 0;
  conflicts jsonb := '[]'::jsonb; s timestamptz; e timestamptz; price int; ph text; sp text; first_reason text;
begin
  if p_kind not in ('avulsa', 'mensalista', 'mensalista_professor') then raise exception 'Tipo de reserva inválido'; end if;
  if p_frequency not in ('semanal', 'quinzenal', 'mensal') then raise exception 'Frequência inválida'; end if;
  if length(trim(coalesce(p_client_name, ''))) < 2 then raise exception 'Informe o nome do cliente'; end if;
  if p_status not in ('pendente', 'confirmada') then raise exception 'Uma nova reserva nasce pendente ou confirmada'; end if;
  if p_until is null and p_count is null then raise exception 'Informe a data final ou a quantidade de ocorrências'; end if;
  if p_count is not null and (p_count < 1 or p_count > 104) then raise exception 'A quantidade de ocorrências vai de 1 a 104'; end if;
  if p_until is not null and p_until > p_first_date + 730 then raise exception 'A recorrência pode durar no máximo 2 anos'; end if;
  if p_until is not null and p_until < p_first_date then raise exception 'A data final deve ser depois da inicial'; end if;
  select * into v from public.court_venues where tenant_id = t;
  if not found then raise exception 'Cadastre o centro esportivo antes de criar reservas'; end if;
  ph := public.court_norm_phone(p_client_phone);
  select coalesce(p_sport, c.sport) into sp from public.court_courts c where c.id = p_court and c.tenant_id = t;
  if sp is null then raise exception 'Quadra não encontrada'; end if;
  insert into public.court_series (tenant_id, court_id, kind, client_name, client_phone, sport, frequency, first_date, start_min, duration_min, until_date, occurrences, price_cents)
  values (t, p_court, p_kind, trim(p_client_name), ph, sp, p_frequency, p_first_date, p_start_min, p_duration_min, p_until, p_count, coalesce(p_price_cents, 0)) returning id into sid;
  while n < 104 and (p_count is null or n < p_count) and (p_until is null or d <= p_until) loop
    n := n + 1;
    s := (d::timestamp + make_interval(mins => p_start_min)) at time zone v.timezone;
    e := s + make_interval(mins => p_duration_min);
    begin
      perform public.court_validate_window(t, p_court, s, e, p_kind, role);
      price := coalesce(p_price_cents, public.court_price_for(t, p_court, s, e, p_kind));
      insert into public.court_bookings (tenant_id, court_id, code, kind, client_name, client_phone, sport, starts_at, ends_at, price_cents, payment_method, status, series_id, occurrence_no)
      values (t, p_court, public.court_next_code(t), p_kind, trim(p_client_name), ph, sp, s, e, price, p_payment_method, p_status, sid, n);
      made := made + 1;
    exception when others then
      conflicts := conflicts || jsonb_build_object('date', d, 'reason', case when sqlstate = '23P01' then 'já existe ' || public.court_conflict_info(t, p_court, s, e) else sqlerrm end);
      if first_reason is null then first_reason := sqlerrm; end if;
    end;
    d := case p_frequency when 'semanal' then d + 7 when 'quinzenal' then d + 14 else (p_first_date + make_interval(months => n))::date end;
  end loop;
  if made = 0 then raise exception 'Nenhuma ocorrência pôde ser criada: %', coalesce(first_reason, 'verifique as datas'); end if;
  return jsonb_build_object('series_id', sid, 'created', made, 'conflicts', conflicts);
end $$;

-- ───────── Histórico de uma reserva (quem fez o quê) ─────────
create function public.court_booking_history(p_id uuid) returns table (at timestamptz, action text, by_name text, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.court_require(array['admin', 'gerente', 'recepcionista', 'financeiro']);
  return query select a.at, a.action, coalesce(pr.full_name, 'Sistema'), a.detail
    from public.audit_log a left join public.profiles pr on pr.id = a.user_id
    where a.entity = 'court_bookings' and a.entity_id = p_id::text and a.tenant_id = public.current_tenant() order by a.at, a.id;
end $$;

revoke execute on function public.court_require(text[]), public.court_local_minutes(timestamptz, text), public.court_local_dow(timestamptz, text), public.court_next_code(uuid),
  public.court_conflict_info(uuid, uuid, timestamptz, timestamptz, uuid), public.court_validate_window(uuid, uuid, timestamptz, timestamptz, text, text),
  public.court_price_for(uuid, uuid, timestamptz, timestamptz, text), public.court_norm_phone(text),
  public.court_booking_create(uuid, text, text, text, text, timestamptz, timestamptz, int, text, text, text, text), public.court_block_create(uuid[], text, timestamptz, timestamptz, text),
  public.court_booking_update(uuid, jsonb, text), public.court_booking_reschedule(uuid, uuid, timestamptz, timestamptz), public.court_booking_cancel(uuid, text, text),
  public.court_series_create(uuid, text, text, text, text, date, int, int, text, date, int, int, text, text), public.court_booking_history(uuid) from public, anon, authenticated;
grant execute on function public.court_booking_create(uuid, text, text, text, text, timestamptz, timestamptz, int, text, text, text, text), public.court_block_create(uuid[], text, timestamptz, timestamptz, text),
  public.court_booking_update(uuid, jsonb, text), public.court_booking_reschedule(uuid, uuid, timestamptz, timestamptz), public.court_booking_cancel(uuid, text, text),
  public.court_series_create(uuid, text, text, text, text, date, int, int, text, date, int, int, text, text), public.court_booking_history(uuid) to authenticated;
-- Cálculo de preço também é útil para a tela (prévia do valor).
create function public.court_price_preview(p_court uuid, p_kind text, p_start timestamptz, p_end timestamptz) returns int
language plpgsql stable security definer set search_path = public as $$
begin perform public.court_require(array['admin', 'gerente', 'recepcionista', 'financeiro']); return public.court_price_for(public.current_tenant(), p_court, p_start, p_end, p_kind); end $$;
revoke execute on function public.court_price_preview(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.court_price_preview(uuid, text, timestamptz, timestamptz) to authenticated;

-- Reversão:
--   drop function public.court_price_preview(uuid, text, timestamptz, timestamptz), public.court_booking_history(uuid), public.court_series_create(uuid, text, text, text, text, date, int, int, text, date, int, int, text, text),
--     public.court_booking_cancel(uuid, text, text), public.court_booking_reschedule(uuid, uuid, timestamptz, timestamptz), public.court_booking_update(uuid, jsonb, text),
--     public.court_block_create(uuid[], text, timestamptz, timestamptz, text), public.court_booking_create(uuid, text, text, text, text, timestamptz, timestamptz, int, text, text, text, text),
--     public.court_norm_phone(text), public.court_price_for(uuid, uuid, timestamptz, timestamptz, text), public.court_validate_window(uuid, uuid, timestamptz, timestamptz, text, text),
--     public.court_conflict_info(uuid, uuid, timestamptz, timestamptz, uuid), public.court_next_code(uuid), public.court_local_dow(timestamptz, text), public.court_local_minutes(timestamptz, text),
--     public.court_require(text[]), public.court_booking_touch(), public.court_hours_validate();
--   drop table public.court_bookings, public.court_counters, public.court_series, public.court_price_rules, public.court_hours;
--   alter table public.court_venues drop column slot_minutes, drop column min_duration_minutes, drop column min_notice_minutes, drop column max_advance_days, drop column cancel_free_hours, drop column cancel_fee_pct;
