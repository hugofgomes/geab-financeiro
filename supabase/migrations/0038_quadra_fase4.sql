-- Quadra Esportiva, Fase 4: financeiro (contas a receber, pagamentos e indicadores).
-- Valores em centavos. Lançamentos e pagamentos NUNCA são apagados: cancelar é uma situação; pagamento é registro imutável.
-- Toda escrita passa por funções transacionais. Só adiciona. Reversão no fim do arquivo.

alter table public.court_counters add column receivables integer not null default 0;

create table public.court_receivables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.resolve_tenant() references public.organizations(id),
  code text not null,
  client_id uuid references public.court_clients(id) on delete restrict,
  client_name text check (client_name is null or length(trim(client_name)) between 2 and 120),
  booking_id uuid references public.court_bookings(id) on delete restrict,
  series_id uuid references public.court_series(id) on delete restrict,
  competence date,                                                      -- 1º dia do mês (cobrança mensal de mensalista)
  description text not null check (length(trim(description)) between 2 and 200),
  issued_on date not null default current_date,
  due_on date not null,
  amount_cents integer not null check (amount_cents between 0 and 100000000),
  paid_cents integer not null default 0 check (paid_cents >= 0),
  payment_method text check (payment_method is null or payment_method in ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'transferencia', 'outro')),
  status text not null default 'aberto' check (status in ('aberto', 'parcial', 'pago', 'cancelado')),   -- "vencido" é calculado pela data de vencimento
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 200),
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),
  check (paid_cents <= amount_cents),
  check (client_id is not null or client_name is not null)
);
-- Sem cobrança duplicada: uma reserva tem no máximo um lançamento não cancelado; uma série, um por mês.
create unique index court_receivables_booking_uniq on public.court_receivables (booking_id) where booking_id is not null and status <> 'cancelado';
create unique index court_receivables_series_uniq on public.court_receivables (series_id, competence) where series_id is not null and status <> 'cancelado';
create index court_receivables_tenant_due_idx on public.court_receivables (tenant_id, due_on);
create index court_receivables_client_idx on public.court_receivables (client_id) where client_id is not null;

create table public.court_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.resolve_tenant() references public.organizations(id),
  receivable_id uuid not null references public.court_receivables(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  method text not null check (method in ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'transferencia', 'outro')),
  paid_on date not null default current_date,
  note text check (note is null or length(note) <= 200),
  gateway text,                                                         -- preparação para Pix/gateways (nada integrado ainda)
  external_ref text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index court_payments_receivable_idx on public.court_payments (receivable_id);
create index court_payments_tenant_paid_idx on public.court_payments (tenant_id, paid_on);
create unique index court_payments_external_uniq on public.court_payments (tenant_id, gateway, external_ref) where external_ref is not null;

create function public.court_receivable_touch() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
-- Pagamento é imutável (rastreabilidade): nem o servidor altera ou apaga.
create function public.court_payment_immutable() returns trigger language plpgsql as $$
begin
  -- única exceção: exclusão definitiva do estabelecimento pelo dono da plataforma (sa_purge_org), após o prazo de recuperação
  if tg_op = 'DELETE' and current_setting('app.purging_org', true) = old.tenant_id::text then return old; end if;
  raise exception 'Pagamentos não podem ser alterados nem excluídos';
end $$;

do $$
declare t text;
begin
  foreach t in array array['court_receivables', 'court_payments']
  loop
    execute format('create trigger a_support_readonly before insert or update or delete on public.%I for each row execute function public.block_support_writes()', t);
    execute format('create trigger a_tenant_guard before insert or update or delete on public.%I for each row execute function public.tenant_guard()', t);
    execute format('create trigger z_audit after insert or update or delete on public.%I for each row execute function public.audit()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select using (public.court_role() in (''admin'', ''gerente'', ''financeiro'') and tenant_id = public.current_tenant())', t || '_read', t);
  end loop;
end $$;
create trigger c_touch before update on public.court_receivables for each row execute function public.court_receivable_touch();
create trigger c_immutable before update or delete on public.court_payments for each row execute function public.court_payment_immutable();
create trigger b_tenant_refs before insert or update on public.court_receivables for each row execute function public.tenant_ref_check('client_id:court_clients', 'booking_id:court_bookings', 'series_id:court_series');
create trigger b_tenant_refs before insert or update on public.court_payments for each row execute function public.tenant_ref_check('receivable_id:court_receivables');

create function public.court_next_receivable_code(p_tenant uuid) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.court_counters (tenant_id, receivables) values (p_tenant, 1)
  on conflict (tenant_id) do update set receivables = public.court_counters.receivables + 1 returning receivables into n;
  return 'L-' || lpad(n::text, 6, '0');
end $$;

-- Mantém a situação da reserva coerente com o lançamento.
create function public.court_sync_booking_payment(p_receivable uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.court_receivables;
begin
  select * into r from public.court_receivables where id = p_receivable;
  if r.booking_id is null or r.status = 'cancelado' then return; end if;
  update public.court_bookings set payment_status = case when r.status = 'pago' then 'pago' when r.paid_cents > 0 then 'parcial' else 'em_aberto' end
  where id = r.booking_id and tenant_id = r.tenant_id;
end $$;

-- ───────── Funções ─────────
-- Cria um lançamento. Com reserva: valor e cliente vêm da reserva (valor pode ser ajustado); evita duplicidade.
create function public.court_receivable_create(p_booking uuid, p_client uuid, p_client_name text, p_description text, p_due date, p_amount_cents int default null, p_method text default null, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t uuid := public.current_tenant(); b public.court_bookings; r public.court_receivables; amt int; cid uuid := p_client; nm text := nullif(trim(coalesce(p_client_name, '')), ''); ds text := nullif(trim(coalesce(p_description, '')), '');
begin
  perform public.court_require(array['admin', 'gerente', 'financeiro']);
  if p_due is null then raise exception 'Informe o vencimento'; end if;
  amt := p_amount_cents;
  if p_booking is not null then
    select * into b from public.court_bookings where id = p_booking and tenant_id = t;
    if not found then raise exception 'Reserva não encontrada'; end if;
    if b.kind = 'bloqueio' then raise exception 'Bloqueios não geram cobrança'; end if;
    if b.status = 'cancelada' then raise exception 'Reserva cancelada não gera cobrança'; end if;
    if exists (select 1 from public.court_receivables x where x.booking_id = p_booking and x.status <> 'cancelado') then raise exception 'Esta reserva já tem um lançamento'; end if;
    amt := coalesce(amt, b.price_cents); cid := coalesce(cid, b.client_id); nm := coalesce(nm, b.client_name);
    ds := coalesce(ds, 'Reserva ' || b.code);
  end if;
  if cid is not null then
    select c.name into nm from public.court_clients c where c.id = cid and c.tenant_id = t;
    if not found then raise exception 'Cliente não encontrado'; end if;
  end if;
  if amt is null or amt < 0 or amt > 100000000 then raise exception 'Valor inválido'; end if;
  if ds is null then raise exception 'Informe a descrição'; end if;
  if nm is null then raise exception 'Informe o cliente'; end if;
  begin
    insert into public.court_receivables (tenant_id, code, client_id, client_name, booking_id, description, due_on, amount_cents, payment_method, status, notes, issued_on)
    values (t, public.court_next_receivable_code(t), cid, nm, p_booking, ds, p_due, amt, p_method, case when amt = 0 then 'pago' else 'aberto' end, nullif(trim(coalesce(p_notes, '')), ''),
            (now() at time zone coalesce((select timezone from public.court_venues where tenant_id = t), 'America/Sao_Paulo'))::date) returning * into r;
  exception when unique_violation then raise exception 'Já existe um lançamento para esta reserva';
  end;
  perform public.court_sync_booking_payment(r.id);
  return to_jsonb(r);
end $$;

-- Edita descrição, vencimento, valor (nunca abaixo do já pago) e observações.
create function public.court_receivable_update(p_id uuid, p_description text, p_due date, p_amount_cents int, p_notes text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.court_receivables;
begin
  perform public.court_require(array['admin', 'gerente', 'financeiro']);
  select * into r from public.court_receivables where id = p_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  if r.status = 'cancelado' then raise exception 'Lançamento cancelado não pode ser editado'; end if;
  if p_amount_cents < r.paid_cents then raise exception 'O valor não pode ser menor que o já pago'; end if;
  if p_amount_cents > 100000000 then raise exception 'Valor inválido'; end if;
  update public.court_receivables set description = coalesce(nullif(trim(p_description), ''), description), due_on = coalesce(p_due, due_on), amount_cents = p_amount_cents,
    notes = nullif(trim(coalesce(p_notes, '')), ''), status = case when p_amount_cents = paid_cents then 'pago' when paid_cents > 0 then 'parcial' else 'aberto' end
    where id = p_id returning * into r;
  perform public.court_sync_booking_payment(r.id);
  return to_jsonb(r);
end $$;

-- Baixa (parcial ou integral). Trava o lançamento: duas baixas simultâneas nunca passam do saldo.
create function public.court_payment_register(p_receivable uuid, p_amount_cents int, p_method text, p_paid_on date default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.court_receivables; t uuid := public.current_tenant(); today date;
begin
  perform public.court_require(array['admin', 'gerente', 'financeiro']);
  select * into r from public.court_receivables where id = p_receivable and tenant_id = t for update;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  if r.status = 'cancelado' then raise exception 'Lançamento cancelado não recebe pagamento'; end if;
  if r.status = 'pago' then raise exception 'Este lançamento já está pago'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Informe um valor maior que zero'; end if;
  if p_amount_cents > r.amount_cents - r.paid_cents then raise exception 'O valor excede o saldo pendente (%)', to_char((r.amount_cents - r.paid_cents) / 100.0, 'FM999G999G990D00'); end if;
  today := (now() at time zone coalesce((select timezone from public.court_venues where tenant_id = t), 'America/Sao_Paulo'))::date;
  if coalesce(p_paid_on, today) > today then raise exception 'A data do pagamento não pode ser futura'; end if;
  insert into public.court_payments (tenant_id, receivable_id, amount_cents, method, paid_on, note) values (t, r.id, p_amount_cents, p_method, coalesce(p_paid_on, today), nullif(trim(coalesce(p_note, '')), ''));
  update public.court_receivables set paid_cents = paid_cents + p_amount_cents, payment_method = p_method,
    status = case when paid_cents + p_amount_cents = amount_cents then 'pago' else 'parcial' end where id = r.id returning * into r;
  perform public.court_sync_booking_payment(r.id);
  return to_jsonb(r);
end $$;

-- Cancela o lançamento (não apaga). Com pagamentos já registrados, não cancela: ajuste o valor ou trate o estorno fora do sistema.
create function public.court_receivable_cancel(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.court_receivables;
begin
  perform public.court_require(array['admin', 'gerente', 'financeiro']);
  select * into r from public.court_receivables where id = p_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  if r.status = 'cancelado' then raise exception 'Lançamento já cancelado'; end if;
  if r.paid_cents > 0 then raise exception 'Há pagamentos registrados: não é possível cancelar o lançamento'; end if;
  update public.court_receivables set status = 'cancelado', cancel_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 200) where id = p_id;
end $$;

-- Mensalista: gera a cobrança de um mês somando as ocorrências não canceladas da série (uma por mês).
create function public.court_receivable_generate_monthly(p_series uuid, p_month date, p_due date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t uuid := public.current_tenant(); s public.court_series; v public.court_venues; m date := date_trunc('month', p_month)::date; total int; n int; r public.court_receivables;
begin
  perform public.court_require(array['admin', 'gerente', 'financeiro']);
  select * into s from public.court_series where id = p_series and tenant_id = t;
  if not found then raise exception 'Recorrência não encontrada'; end if;
  select * into v from public.court_venues where tenant_id = t;
  select coalesce(sum(price_cents), 0), count(*) into total, n from public.court_bookings b
    where b.series_id = p_series and b.tenant_id = t and b.status <> 'cancelada' and (b.starts_at at time zone v.timezone)::date >= m and (b.starts_at at time zone v.timezone)::date < (m + interval '1 month')::date;
  if n = 0 then raise exception 'Nenhuma reserva ativa desta recorrência no mês'; end if;
  begin
    insert into public.court_receivables (tenant_id, code, client_id, client_name, series_id, competence, description, due_on, amount_cents, status, issued_on)
    values (t, public.court_next_receivable_code(t), s.client_id, s.client_name, p_series, m, 'Mensalidade ' || to_char(m, 'MM/YYYY') || ' (' || n || ' horário(s))', coalesce(p_due, m + 4), total, case when total = 0 then 'pago' else 'aberto' end,
            (now() at time zone v.timezone)::date) returning * into r;
  exception when unique_violation then raise exception 'A mensalidade deste mês já foi gerada';
  end;
  return to_jsonb(r);
end $$;

-- Cancelamento de reserva aplica a regra financeira SEM apagar nada: sem pagamento → lançamento cancelado (ou reduzido à multa de
-- cancelamento tardio, quando configurada); com pagamento → lançamento mantido e sinalizado nas observações para tratamento manual.
create function public.court_booking_cancel_finance() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.court_receivables; v public.court_venues; fee int;
begin
  if new.status <> 'cancelada' or old.status = 'cancelada' then return new; end if;
  select * into r from public.court_receivables where booking_id = new.id and status <> 'cancelado' for update;
  if not found then return new; end if;
  select * into v from public.court_venues where tenant_id = new.tenant_id;
  fee := case when new.late_cancel then (r.amount_cents * coalesce(v.cancel_fee_pct, 0) / 100) else 0 end;
  if r.paid_cents > 0 then
    update public.court_receivables set notes = left(coalesce(notes || ' | ', '') || 'Reserva cancelada com pagamento registrado: tratar devolução ou crédito manualmente', 500) where id = r.id;
  elsif fee > 0 then
    update public.court_receivables set amount_cents = fee, description = left(description || ' (multa de cancelamento tardio)', 200) where id = r.id;
  else
    update public.court_receivables set status = 'cancelado', cancel_reason = 'Reserva cancelada' where id = r.id;
  end if;
  return new;
end $$;
create trigger e_cancel_finance after update of status on public.court_bookings for each row execute function public.court_booking_cancel_finance();

-- Indicadores do período (datas locais do centro). Recebido = pagamentos com data no período.
create function public.court_finance_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_tenant(); today date; res jsonb;
begin
  perform public.court_require(array['admin', 'gerente', 'financeiro']);
  today := (now() at time zone coalesce((select timezone from public.court_venues where tenant_id = t), 'America/Sao_Paulo'))::date;
  select jsonb_build_object(
    'to_receive', coalesce((select sum(amount_cents - paid_cents) from public.court_receivables where tenant_id = t and status in ('aberto', 'parcial')), 0),
    'overdue', coalesce((select sum(amount_cents - paid_cents) from public.court_receivables where tenant_id = t and status in ('aberto', 'parcial') and due_on < today), 0),
    'overdue_count', (select count(*) from public.court_receivables where tenant_id = t and status in ('aberto', 'parcial') and due_on < today),
    'received', coalesce((select sum(amount_cents) from public.court_payments where tenant_id = t and paid_on between p_from and p_to), 0),
    'by_court', coalesce((select jsonb_agg(x) from (select c.name, sum(p.amount_cents)::bigint cents from public.court_payments p join public.court_receivables r on r.id = p.receivable_id
        join public.court_bookings b on b.id = r.booking_id join public.court_courts c on c.id = b.court_id where p.tenant_id = t and p.paid_on between p_from and p_to group by c.name order by 2 desc) x), '[]'),
    'by_sport', coalesce((select jsonb_agg(x) from (select coalesce(b.sport, 'outra') sport, sum(p.amount_cents)::bigint cents from public.court_payments p join public.court_receivables r on r.id = p.receivable_id
        join public.court_bookings b on b.id = r.booking_id where p.tenant_id = t and p.paid_on between p_from and p_to group by 1 order by 2 desc) x), '[]'),
    'by_kind', coalesce((select jsonb_agg(x) from (select b.kind, sum(p.amount_cents)::bigint cents from public.court_payments p join public.court_receivables r on r.id = p.receivable_id
        join public.court_bookings b on b.id = r.booking_id where p.tenant_id = t and p.paid_on between p_from and p_to group by 1 order by 2 desc) x), '[]')
  ) into res;
  return res;
end $$;

do $$
declare f text;
begin
  foreach f in array array['court_receivable_create(uuid, uuid, text, text, date, int, text, text)', 'court_receivable_update(uuid, text, date, int, text)', 'court_payment_register(uuid, int, text, date, text)',
    'court_receivable_cancel(uuid, text)', 'court_receivable_generate_monthly(uuid, date, date)', 'court_finance_summary(date, date)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Reversão:
--   drop trigger e_cancel_finance on public.court_bookings;
--   drop function public.court_finance_summary(date, date), public.court_booking_cancel_finance(), public.court_receivable_generate_monthly(uuid, date, date), public.court_receivable_cancel(uuid, text),
--     public.court_payment_register(uuid, int, text, date, text), public.court_receivable_update(uuid, text, date, int, text), public.court_receivable_create(uuid, uuid, text, text, date, int, text, text),
--     public.court_sync_booking_payment(uuid), public.court_next_receivable_code(uuid), public.court_payment_immutable(), public.court_receivable_touch();
--   drop table public.court_payments, public.court_receivables; alter table public.court_counters drop column receivables;
