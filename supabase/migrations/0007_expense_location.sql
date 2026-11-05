-- Local da despesa (onde o gasto aconteceu: quadra, loja, bar...). Opcional.
alter table public.expenses
  add column location text check (location is null or length(location) between 1 and 80);
create index on public.expenses (location) where location is not null;
