-- GEAB Futebol — schema base (MVP: atletas, mensalidades, pagamentos, caixa).
-- Regras de negócio ficam no banco para valerem para qualquer cliente (app, importação, webhook futuro).

create type public.app_role as enum ('admin', 'atleta');
create type public.charge_status as enum ('pendente', 'parcial', 'pago', 'em_conferencia');
create type public.payment_method as enum ('pix', 'dinheiro', 'transferencia', 'outro');
create type public.payment_source as enum ('manual', 'extrato', 'pix_webhook');

-- ───────── Cadastro ─────────
create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  nickname text,
  phone text,                              -- WhatsApp, só dígitos com DDI (ex.: 5548999999999)
  email text,
  cpf text,                                -- opcional; só quando necessário
  monthly_fee numeric(12,2) not null default 100 check (monthly_fee >= 0),
  due_day smallint not null default 10 check (due_day between 1 and 28),
  active boolean not null default true,
  whatsapp_consent boolean not null default false,   -- consentimento para receber mensagens
  joined_at date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.app_role not null default 'atleta',
  athlete_id uuid unique references public.athletes(id) on delete set null,
  active boolean not null default true
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active)
$$;

create function public.my_athlete() returns uuid
language sql stable security definer set search_path = public as $$
  select athlete_id from public.profiles where id = auth.uid() and active
$$;

-- ───────── Financeiro ─────────
create table public.charges (            -- mensalidades
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id),
  competence date not null check (extract(day from competence) = 1),
  due_date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  status public.charge_status not null default 'pendente',
  created_at timestamptz not null default now(),
  unique (athlete_id, competence)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id),
  charge_id uuid not null references public.charges(id),
  amount numeric(12,2) not null check (amount > 0),
  paid_at date not null,
  method public.payment_method not null default 'pix',
  source public.payment_source not null default 'manual',
  bank_txid text,                          -- identificador bancário (E2E id do Pix / FITID do extrato)
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
-- Uma transação bancária nunca baixa duas vezes.
create unique index payments_bank_txid_uniq on public.payments (bank_txid) where bank_txid is not null;
create index on public.payments (charge_id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  spent_at date not null,
  description text not null,
  category text,
  amount numeric(12,2) not null check (amount > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb
);

-- ───────── Regras ─────────
-- Valida coerência e impede pagamento acima do valor da mensalidade (evita baixa duplicada).
create function public.check_payment() returns trigger
language plpgsql as $$
declare c record; total numeric;
begin
  select * into c from public.charges where id = new.charge_id;
  if c.athlete_id <> new.athlete_id then
    raise exception 'A mensalidade não pertence a este atleta';
  end if;
  select coalesce(sum(amount), 0) into total from public.payments
    where charge_id = new.charge_id and id is distinct from new.id;
  if total + new.amount > c.amount then
    raise exception 'Pagamento excede o valor da mensalidade (restante: %)', c.amount - total;
  end if;
  return new;
end $$;
create trigger payments_check before insert or update on public.payments
  for each row execute function public.check_payment();

-- Recalcula o status da mensalidade conforme os pagamentos.
create function public.recompute_charge() returns trigger
language plpgsql as $$
declare cid uuid; total numeric; c record;
begin
  for cid in select distinct x from unnest(array[
      case when tg_op <> 'DELETE' then new.charge_id end,
      case when tg_op <> 'INSERT' then old.charge_id end]) as x where x is not null
  loop
    select * into c from public.charges where id = cid;
    select coalesce(sum(amount), 0) into total from public.payments where charge_id = cid;
    update public.charges set status = case
        when total >= c.amount then 'pago'::public.charge_status
        when total > 0 then 'parcial'::public.charge_status
        when c.status = 'em_conferencia' then c.status
        else 'pendente'::public.charge_status end
      where id = cid;
  end loop;
  return null;
end $$;
create trigger payments_recompute after insert or update or delete on public.payments
  for each row execute function public.recompute_charge();

-- Auditoria.
create function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (user_id, action, entity, entity_id, detail)
  values (auth.uid(), tg_op, tg_table_name,
          coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, ''),
          case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  return null;
end $$;
create trigger audit_payments after insert or update or delete on public.payments for each row execute function public.audit();
create trigger audit_athletes after insert or update or delete on public.athletes for each row execute function public.audit();
create trigger audit_expenses after insert or update or delete on public.expenses for each row execute function public.audit();
create trigger audit_charges after update or delete on public.charges for each row execute function public.audit();

-- Gera as mensalidades de um mês para os atletas ativos (idempotente).
create function public.generate_charges(p_competence date) returns int
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_competence)::date; n int;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  insert into public.charges (athlete_id, competence, due_date, amount)
  select a.id, m, m + (a.due_day - 1), a.monthly_fee
  from public.athletes a
  where a.active and a.joined_at < (m + interval '1 month')::date
  on conflict (athlete_id, competence) do nothing;
  get diagnostics n = row_count;
  insert into public.audit_log (user_id, action, entity, entity_id, detail)
    values (auth.uid(), 'GENERATE', 'charges', m::text, jsonb_build_object('created', n));
  return n;
end $$;

-- O atleta só pode alterar o próprio contato.
create function public.update_my_contact(p_phone text, p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_athlete() is null then raise exception 'Sem atleta vinculado'; end if;
  update public.athletes set phone = p_phone, email = p_email where id = public.my_athlete();
end $$;

-- ───────── Visões ─────────
create view public.charges_view with (security_invoker = true) as
select c.*,
       coalesce(p.paid, 0) as paid_total,
       c.amount - coalesce(p.paid, 0) as balance,
       case when c.status in ('pendente', 'parcial') and c.due_date < current_date
            then 'atrasado' else c.status::text end as display_status
from public.charges c
left join lateral (select sum(amount) as paid from public.payments where charge_id = c.id) p on true;

-- ───────── RLS ─────────
alter table public.athletes enable row level security;
alter table public.profiles enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_log enable row level security;

create policy athletes_admin on public.athletes for all using (public.is_admin()) with check (public.is_admin());
create policy athletes_self on public.athletes for select using (id = public.my_athlete());

create policy profiles_admin on public.profiles for all using (public.is_admin()) with check (public.is_admin());
create policy profiles_self on public.profiles for select using (id = auth.uid());

create policy charges_admin on public.charges for all using (public.is_admin()) with check (public.is_admin());
create policy charges_self on public.charges for select using (athlete_id = public.my_athlete());

create policy payments_admin on public.payments for all using (public.is_admin()) with check (public.is_admin());
create policy payments_self on public.payments for select using (athlete_id = public.my_athlete());

create policy expenses_admin on public.expenses for all using (public.is_admin()) with check (public.is_admin());

create policy audit_admin on public.audit_log for select using (public.is_admin());

-- ───────── Notificações (histórico de mensagens enviadas ao atleta) ─────────
create type public.notification_kind as enum ('confirmacao', 'lembrete', 'cobranca');
create type public.notification_status as enum ('aberta', 'enviada', 'falhou');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id),
  charge_id uuid references public.charges(id),
  kind public.notification_kind not null,
  channel text not null default 'wa_link',      -- wa_link (manual) | whatsapp_api (futuro)
  status public.notification_status not null default 'aberta',
  error text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy notifications_admin on public.notifications for all using (public.is_admin()) with check (public.is_admin());
create index on public.notifications (charge_id, kind);

-- Saldo de caixa calculado no banco (não depende de paginação do cliente).
create view public.cash_summary with (security_invoker = true) as
select (select coalesce(sum(amount), 0) from public.payments) as total_in,
       (select coalesce(sum(amount), 0) from public.expenses) as total_out;
