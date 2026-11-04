-- Dá acesso à área do atleta. Crie o usuário em Authentication > Users e rode, trocando os valores.
insert into public.profiles (id, full_name, role, athlete_id)
select u.id, a.full_name, 'atleta', a.id
from auth.users u, public.athletes a
where u.email = 'EMAIL-DO-ATLETA@exemplo.com'
  and a.full_name = 'NOME COMPLETO IGUAL AO CADASTRO'
on conflict (id) do update set athlete_id = excluded.athlete_id, role = 'atleta', active = true;
