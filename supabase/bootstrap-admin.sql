-- 1) Authentication > Users > Add user (e-mail + senha, marque "Auto Confirm User").
-- 2) Troque o e-mail e rode este script para tornar esse usuário administrador.
insert into public.profiles (id, full_name, role)
select id, 'Administrador GEAB', 'admin'
from auth.users
where email = 'TROQUE@PELO-EMAIL.com'
on conflict (id) do update set role = 'admin', active = true;
