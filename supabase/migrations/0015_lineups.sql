-- Escalação dos jogos: quem joga em cada equipe (Azul/Branca), goleiros, número da camisa e reservas.
-- Reaproveita athletes e matches. Só a Diretoria grava; qualquer usuário ativo pode consultar.

alter table public.matches
  add column venue text check (venue is null or length(trim(venue)) between 1 and 120),   -- local da partida
  add column lineup_confirmed boolean not null default false;                              -- escalação confirmada (trava a edição)

create type public.lineup_team as enum ('a', 'b', 'reserva');

create table public.match_lineups (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  team public.lineup_team not null,
  is_keeper boolean not null default false,
  shirt_number smallint check (shirt_number is null or shirt_number between 0 and 99),
  sort_order smallint not null default 0,
  unique (match_id, athlete_id)                       -- o mesmo atleta nunca entra nas duas equipes
);
create index match_lineups_match_idx on public.match_lineups (match_id);

alter table public.match_lineups enable row level security;
create policy match_lineups_admin on public.match_lineups for all using (public.is_admin()) with check (public.is_admin());
create policy match_lineups_member on public.match_lineups for select using (public.is_member());
create trigger audit_match_lineups after insert or update or delete on public.match_lineups
  for each row execute function public.audit();

-- Grava a escalação inteira de um jogo numa só transação (substitui a anterior).
create function public.set_match_lineup(p_match uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb; aid uuid; seen uuid[] := '{}'; n int := 0;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  if not exists (select 1 from public.matches where id = p_match) then raise exception 'Jogo não encontrado'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'Lista inválida'; end if;
  if exists (select 1 from public.matches where id = p_match and lineup_confirmed) then
    raise exception 'Escalação confirmada: reabra a edição para alterar';
  end if;
  delete from public.match_lineups where match_id = p_match;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    aid := (r->>'athlete_id')::uuid;
    if aid = any(seen) then raise exception 'Atleta repetido na escalação'; end if;
    seen := seen || aid;
    insert into public.match_lineups (match_id, athlete_id, team, is_keeper, shirt_number, sort_order)
    values (p_match, aid, (r->>'team')::public.lineup_team, coalesce((r->>'is_keeper')::boolean, false),
            nullif(r->>'shirt_number', '')::smallint, n);
    n := n + 1;
  end loop;
end $$;

revoke execute on function public.set_match_lineup(uuid, jsonb) from public, anon;
grant execute on function public.set_match_lineup(uuid, jsonb) to authenticated;
