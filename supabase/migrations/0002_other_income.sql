-- Entradas que não são mensalidade (patrocínio, uniforme, dinheiro, ajuste de saldo inicial).
create table public.other_income (
  id uuid primary key default gen_random_uuid(),
  received_at date not null,
  description text not null,
  category text,
  amount numeric(12,2) not null check (amount > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.other_income enable row level security;
create policy other_income_admin on public.other_income for all using (public.is_admin()) with check (public.is_admin());
create trigger audit_other_income after insert or update or delete on public.other_income
  for each row execute function public.audit();

-- O saldo em caixa passa a somar também as outras entradas.
create or replace view public.cash_summary with (security_invoker = true) as
select (select coalesce(sum(amount), 0) from public.payments)
     + (select coalesce(sum(amount), 0) from public.other_income) as total_in,
       (select coalesce(sum(amount), 0) from public.expenses) as total_out;
