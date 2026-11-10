-- Três níveis de acesso, aplicados no banco (não dá para burlar pela tela):
--   atleta     → só a própria conta e os próprios dados (como já era).
--   diretoria  → CONSULTA todas as áreas operacionais; não altera nada e não acessa a administração.
--   admin      → gerencia tudo (como já era).
-- Área administrativa (só admin): usuários e privilégios, auditoria, importação de planilha, dados do grupo, integrações (BTG/Pix).

-- Diretoria ou admin, ativo.
create function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'diretoria') and active)
$$;
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- Leitura para a Diretoria, sempre dentro da própria organização. Escrita continua só com is_admin() (políticas *_admin).
do $$
declare t text;
begin
  foreach t in array array['athletes','charges','payments','expenses','other_income','notifications','matches','match_players',
                           'match_lineups','pix_charges','signup_requests']
  loop
    execute format('create policy %I on public.%I for select using (public.is_staff() and tenant_id = public.current_tenant())', t || '_staff', t);
  end loop;
end $$;
-- Ficam de fora (só admin): audit_log, profiles (lista de usuários), app_settings de escrita, btg_connection, org_internal.

-- Promover alguém a diretoria não pode apagar o vínculo dele com o cadastro de atleta (a pessoa continua sendo atleta também).
create or replace function public.admin_update_user(p_user uuid, p_full_name text, p_role public.app_role, p_active boolean, p_athlete uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare nm text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g'); cur public.profiles; tn uuid := public.current_tenant();
begin
  if not public.is_admin() then raise exception 'Apenas a Diretoria'; end if;
  select * into cur from public.profiles where id = p_user and tenant_id = tn for update;
  if not found then raise exception 'Usuário não encontrado'; end if;
  if length(nm) < 3 or length(nm) > 120 then raise exception 'Informe o nome completo (3 a 120 caracteres)'; end if;
  if p_user = auth.uid() and (p_role <> cur.role or p_active <> cur.active) then
    raise exception 'Você não pode alterar o seu próprio papel ou situação';
  end if;
  if p_role = 'atleta' and coalesce(p_athlete, cur.athlete_id) is null then raise exception 'Usuário atleta precisa estar vinculado a um atleta'; end if;
  if p_athlete is not null and not exists (select 1 from public.athletes where id = p_athlete and tenant_id = tn) then
    raise exception 'Atleta não encontrado';
  end if;
  if p_athlete is not null and exists (select 1 from public.profiles where athlete_id = p_athlete and id <> p_user) then
    raise exception 'Este atleta já está vinculado a outro usuário';
  end if;
  update public.profiles set full_name = nm, role = p_role, active = p_active,
         athlete_id = case when p_role = 'admin' then null else coalesce(p_athlete, cur.athlete_id) end
   where id = p_user and tenant_id = tn;
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
  values (tn, auth.uid(), 'UPDATE_USER', 'profiles', p_user::text,
          jsonb_build_object('role', p_role, 'active', p_active, 'athlete_id', coalesce(p_athlete, cur.athlete_id)));
end $$;
