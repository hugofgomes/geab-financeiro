-- Contas e privilégios: "admin" = Diretoria (vê e gerencia tudo); "atleta" vê só a própria conta.

-- Nunca deixar o sistema sem nenhum administrador ativo.
create function public.guard_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'O sistema precisa ter pelo menos um usuário da Diretoria ativo';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger profiles_guard_last_admin before update or delete on public.profiles
  for each row execute function public.guard_last_admin();

-- Atleta edita o próprio nome (e apelido). O resto do cadastro só a Diretoria altera.
create function public.update_my_profile(p_full_name text, p_nickname text default null) returns void
language plpgsql security definer set search_path = public as $$
declare nm text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if length(nm) < 3 or length(nm) > 120 then raise exception 'Informe o nome completo (3 a 120 caracteres)'; end if;
  update public.profiles set full_name = nm where id = auth.uid() and active;
  if not found then raise exception 'Usuário sem acesso liberado'; end if;
  if public.my_athlete() is not null then
    update public.athletes set full_name = nm, nickname = nullif(left(trim(coalesce(p_nickname, '')), 60), '')
    where id = public.my_athlete();
  end if;
end $$;

-- Lista de usuários para a Diretoria (e-mail vem de auth.users, que o app não lê direto).
create function public.admin_users() returns table (
  id uuid, full_name text, email text, role public.app_role, active boolean,
  athlete_id uuid, athlete_name text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Apenas a Diretoria'; end if;
  return query
    select p.id, p.full_name, u.email::text, p.role, p.active, p.athlete_id, a.full_name, u.created_at, u.last_sign_in_at
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.athletes a on a.id = p.athlete_id
    order by (p.role = 'admin') desc, p.full_name;
end $$;

-- Edita um usuário. Ninguém altera o próprio papel/situação (evita se trancar fora).
create function public.admin_update_user(p_user uuid, p_full_name text, p_role public.app_role, p_active boolean, p_athlete uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare nm text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g'); cur public.profiles;
begin
  if not public.is_admin() then raise exception 'Apenas a Diretoria'; end if;
  select * into cur from public.profiles where id = p_user for update;
  if not found then raise exception 'Usuário não encontrado'; end if;
  if length(nm) < 3 or length(nm) > 120 then raise exception 'Informe o nome completo (3 a 120 caracteres)'; end if;
  if p_user = auth.uid() and (p_role <> cur.role or p_active <> cur.active) then
    raise exception 'Você não pode alterar o seu próprio papel ou situação';
  end if;
  if p_role = 'atleta' and p_athlete is null then raise exception 'Usuário atleta precisa estar vinculado a um atleta'; end if;
  if p_athlete is not null and exists (select 1 from public.profiles where athlete_id = p_athlete and id <> p_user) then
    raise exception 'Este atleta já está vinculado a outro usuário';
  end if;
  update public.profiles set full_name = nm, role = p_role, active = p_active,
         athlete_id = case when p_role = 'admin' then null else p_athlete end
   where id = p_user;
  insert into public.audit_log (user_id, action, entity, entity_id, detail)
  values (auth.uid(), 'UPDATE_USER', 'profiles', p_user::text,
          jsonb_build_object('role', p_role, 'active', p_active, 'athlete_id', p_athlete));
end $$;

-- Remove o acesso (o login deixa de abrir qualquer tela). Dados do atleta e pagamentos ficam intactos.
create function public.admin_remove_access(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Apenas a Diretoria'; end if;
  if p_user = auth.uid() then raise exception 'Você não pode remover o seu próprio acesso'; end if;
  delete from public.profiles where id = p_user;
  if not found then raise exception 'Usuário não encontrado'; end if;
  insert into public.audit_log (user_id, action, entity, entity_id, detail)
  values (auth.uid(), 'REMOVE_ACCESS', 'profiles', p_user::text, '{}'::jsonb);
end $$;

revoke execute on function public.update_my_profile(text, text), public.admin_users(),
  public.admin_update_user(uuid, text, public.app_role, boolean, uuid), public.admin_remove_access(uuid) from public, anon;
grant execute on function public.update_my_profile(text, text), public.admin_users(),
  public.admin_update_user(uuid, text, public.app_role, boolean, uuid), public.admin_remove_access(uuid) to authenticated;
