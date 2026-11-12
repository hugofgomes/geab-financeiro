-- Nome padrão da segunda equipe: "Equipe Branco" (antes "Equipe Branca"), inclusive nos jogos já gravados.
alter table public.matches alter column team_b set default 'Equipe Branco';
update public.matches set team_b = 'Equipe Branco' where team_b = 'Equipe Branca';
update public.matches set team_a = 'Equipe Branco' where team_a = 'Equipe Branca';
