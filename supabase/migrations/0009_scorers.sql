-- Artilharia: quem jogou cada partida e quantos gols fez. Uma linha por (jogo, atleta) — sem duplicidade.
-- Temporada = ano civil da data do jogo. Só contam jogos FINALIZADOS.

create table public.match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id),
  goals smallint not null default 0 check (goals between 0 and 30),
  created_at timestamptz not null default now(),
  unique (match_id, athlete_id)
);
create index match_players_athlete_idx on public.match_players (athlete_id);

-- A soma dos gols dos atletas não pode passar do total do placar (gols contra/sem autor ficam de fora).
create function public.assert_goals_fit(p_match uuid) returns void
language plpgsql set search_path = public as $$
declare g int; t int; m record;
begin
  select * into m from public.matches where id = p_match;
  if not found then return; end if;
  select coalesce(sum(goals), 0) into g from public.match_players where match_id = p_match;
  if g = 0 then return; end if;
  if m.score_a is null or m.score_b is null then
    raise exception 'Informe o placar do jogo antes de registrar gols dos atletas';
  end if;
  t := m.score_a + m.score_b;
  if g > t then
    raise exception 'A soma dos gols dos atletas (%) passa do total do placar (%)', g, t;
  end if;
end $$;

create function public.match_players_check() returns trigger
language plpgsql set search_path = public as $$
begin perform public.assert_goals_fit(new.match_id); return null; end $$;
create trigger match_players_fit after insert or update on public.match_players
  for each row execute function public.match_players_check();

create function public.matches_goals_check() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.score_a is distinct from old.score_a or new.score_b is distinct from old.score_b then
    perform public.assert_goals_fit(new.id);
  end if;
  return null;
end $$;
create trigger matches_goals_fit after update on public.matches
  for each row execute function public.matches_goals_check();

alter table public.match_players enable row level security;
create policy match_players_admin on public.match_players for all using (public.is_admin()) with check (public.is_admin());
create policy match_players_member on public.match_players for select using (public.is_member());
create trigger audit_match_players after insert or update or delete on public.match_players
  for each row execute function public.audit();

-- Grava de uma vez quem jogou e os gols de um jogo (substitui a lista anterior, numa só transação).
create function public.set_match_players(p_match uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb; aid uuid; g int; seen uuid[] := '{}';
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  if not exists (select 1 from public.matches where id = p_match) then raise exception 'Jogo não encontrado'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'Lista inválida'; end if;
  delete from public.match_players where match_id = p_match;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    aid := (r->>'athlete_id')::uuid;
    g := coalesce((r->>'goals')::int, 0);
    if aid = any(seen) then raise exception 'Atleta repetido na lista do jogo'; end if;
    if g < 0 or g > 30 then raise exception 'Gols deve estar entre 0 e 30'; end if;
    seen := seen || aid;
    insert into public.match_players (match_id, athlete_id, goals) values (p_match, aid, g);
  end loop;
end $$;

-- ───────── Consultas para a barra lateral (nome de exibição, gols e jogos; nada de contato) ─────────
create function public.scorer_seasons() returns int[]
language plpgsql stable security definer set search_path = public as $$
declare cur int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int; res int[];
begin
  if not public.is_member() then raise exception 'Acesso negado'; end if;
  select coalesce(array_agg(y order by y desc), '{}') into res from (
    select distinct extract(year from m.match_date)::int as y
    from public.match_players mp join public.matches m on m.id = mp.match_id and m.status = 'finalizado'
    union select cur) s;
  return res;
end $$;

create function public.top_scorers(p_season int default null)
returns table (athlete_id uuid, display_name text, goals int, games int, pos int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare s int := coalesce(p_season, extract(year from (now() at time zone 'America/Sao_Paulo'))::int);
begin
  if not public.is_member() then raise exception 'Acesso negado'; end if;
  return query
  with t as (
    select a.id as aid, coalesce(nullif(trim(a.nickname), ''), a.full_name) as nome,
           sum(mp.goals)::int as g, count(*)::int as j
    from public.match_players mp
    join public.matches m on m.id = mp.match_id and m.status = 'finalizado' and extract(year from m.match_date)::int = s
    join public.athletes a on a.id = mp.athlete_id
    group by a.id, a.nickname, a.full_name
  )
  select t.aid, t.nome, t.g, t.j, (rank() over (order by t.g desc))::int
  from t where t.g > 0
  order by 5, t.j, t.nome
  limit 5;
end $$;

create function public.scorer_stats(p_athlete uuid, p_season int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  s int := coalesce(p_season, extract(year from (now() at time zone 'America/Sao_Paulo'))::int);
  nome text; g int; j int; mes int; pos int; hist jsonb;
begin
  if not public.is_member() then raise exception 'Acesso negado'; end if;
  select coalesce(nullif(trim(a.nickname), ''), a.full_name) into nome from public.athletes a where a.id = p_athlete;
  if nome is null then raise exception 'Atleta não encontrado'; end if;
  select coalesce(sum(mp.goals), 0)::int, count(*)::int into g, j
    from public.match_players mp join public.matches m on m.id = mp.match_id and m.status = 'finalizado'
    where mp.athlete_id = p_athlete and extract(year from m.match_date)::int = s;
  if s = extract(year from hoje)::int then
    select coalesce(sum(mp.goals), 0)::int into mes
      from public.match_players mp join public.matches m on m.id = mp.match_id and m.status = 'finalizado'
      where mp.athlete_id = p_athlete and extract(year from m.match_date)::int = s and extract(month from m.match_date) = extract(month from hoje);
  end if;
  if g > 0 then
    select 1 + count(*)::int into pos from (
      select mp.athlete_id from public.match_players mp
      join public.matches m on m.id = mp.match_id and m.status = 'finalizado' and extract(year from m.match_date)::int = s
      group by mp.athlete_id having sum(mp.goals) > g) x;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('date', m.match_date, 'team_a', m.team_a, 'team_b', m.team_b,
           'score_a', m.score_a, 'score_b', m.score_b, 'goals', mp.goals) order by m.match_date desc, m.match_time desc nulls last), '[]'::jsonb) into hist
    from public.match_players mp join public.matches m on m.id = mp.match_id and m.status = 'finalizado'
    where mp.athlete_id = p_athlete and extract(year from m.match_date)::int = s;
  return jsonb_build_object('name', nome, 'season', s, 'goals', g, 'games', j,
    'avg', case when j > 0 then round(g::numeric / j, 2) else 0 end,
    'month_goals', mes, 'position', pos, 'history', hist);
end $$;

revoke execute on function public.scorer_seasons(), public.top_scorers(int), public.scorer_stats(uuid, int), public.set_match_players(uuid, jsonb) from public, anon;
grant execute on function public.scorer_seasons(), public.top_scorers(int), public.scorer_stats(uuid, int), public.set_match_players(uuid, jsonb) to authenticated;
