-- Jogos (placar, histórico e próximo jogo) e aniversariantes do mês para a barra lateral.

create type public.match_status as enum ('agendado', 'em_andamento', 'finalizado');

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  match_date date not null,
  match_time time,                                   -- nulo = "a definir"
  team_a text not null default 'Equipe Azul' check (length(trim(team_a)) between 1 and 40),
  team_b text not null default 'Equipe Branca' check (length(trim(team_b)) between 1 and 40),
  score_a smallint check (score_a between 0 and 99),
  score_b smallint check (score_b between 0 and 99),
  status public.match_status not null default 'agendado',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (lower(trim(team_a)) <> lower(trim(team_b))),
  check (status <> 'finalizado' or (score_a is not null and score_b is not null))
);
create index matches_date_idx on public.matches (match_date desc, match_time desc nulls last);

-- Qualquer usuário ativo (Diretoria ou atleta) pode consultar.
create function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

alter table public.matches enable row level security;
create policy matches_admin on public.matches for all using (public.is_admin()) with check (public.is_admin());
create policy matches_member on public.matches for select using (public.is_member());
create trigger audit_matches after insert or update or delete on public.matches
  for each row execute function public.audit();

-- Aniversariantes do mês atual (fuso de Brasília). Expõe só nome de exibição, dia, mês e idade:
-- não revela a data completa nem dados de contato aos demais atletas.
create function public.month_birthdays()
returns table (display_name text, bday int, bmonth int, turning_age int, is_today boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ano int := extract(year from hoje);
  bissexto boolean := (ano % 4 = 0 and ano % 100 <> 0) or ano % 400 = 0;
begin
  if not public.is_member() then raise exception 'Acesso negado'; end if;
  return query
  select d.nome, d.dia, d.mes, ano - extract(year from d.nasc)::int,
         (d.mes = extract(month from hoje)::int and d.dia = extract(day from hoje)::int)
  from (
    select coalesce(nullif(trim(a.nickname), ''), a.full_name) as nome,
           case when extract(month from a.birth_date) = 2 and extract(day from a.birth_date) = 29 and not bissexto
                then 28 else extract(day from a.birth_date)::int end as dia,
           extract(month from a.birth_date)::int as mes,
           a.birth_date as nasc
    from public.athletes a
    where a.active and a.birth_date is not null
  ) d
  where d.mes = extract(month from hoje)::int and d.nasc <= hoje
  order by d.dia, d.nome;
end $$;

revoke execute on function public.month_birthdays() from public, anon;
revoke execute on function public.is_member() from public, anon;
grant execute on function public.month_birthdays() to authenticated;
grant execute on function public.is_member() to authenticated;
