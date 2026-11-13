-- Modo espião (suporte): o dono da plataforma abre o painel de um cliente, SOMENTE LEITURA, por tempo limitado e com registro.
-- Como funciona: sessão em support_sessions → current_tenant() passa a devolver o grupo visitado (as regras de acesso do banco
-- fazem o resto) e um gatilho em TODAS as tabelas com tenant_id recusa qualquer escrita enquanto a sessão estiver ativa.
-- Início e fim ficam no audit_log DO CLIENTE (ele pode ver que houve acesso de suporte). Reversão no fim do arquivo.

create table public.support_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.support_sessions enable row level security;   -- sem políticas: só funções

create function public.in_support_mode() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.support_sessions where user_id = auth.uid() and expires_at > now())
$$;

-- Com sessão de suporte ativa (só para o dono da plataforma), o "grupo atual" é o visitado, mesmo suspenso ou excluído.
create or replace function public.current_tenant() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.org_id from public.support_sessions s where s.user_id = auth.uid() and s.expires_at > now() and public.is_platform_admin()),
    (select p.tenant_id from public.profiles p join public.organizations o on o.id = p.tenant_id
      where p.id = auth.uid() and p.active and public.org_usable(o.status, o.trial_ends_at)))
$$;

create function public.block_support_writes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.in_support_mode() then raise exception 'Modo espião: somente leitura. Saia do modo espião para fazer alterações'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Gatilho de bloqueio em todas as tabelas de dados dos grupos (menos os registros de auditoria/acesso, que o próprio sistema grava).
do $$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name not in ('audit_log', 'access_log')
  loop
    execute format('create trigger a_support_readonly before insert or update or delete on public.%I for each row execute function public.block_support_writes()', t);
  end loop;
end $$;

-- Sessão atual (para o banner do painel)
create function public.my_support_session() returns table (org_id uuid, org_name text, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.org_id, o.name, s.expires_at from public.support_sessions s join public.organizations o on o.id = s.org_id
  where s.user_id = auth.uid() and s.expires_at > now() and public.is_platform_admin()
$$;

create function public.sa_support_start(p_org uuid, p_reason text, p_minutes int default 60) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sa_guard();
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'Grupo não encontrado'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Informe o motivo do acesso de suporte'; end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 240 then raise exception 'Duração: de 5 a 240 minutos'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active) then
    raise exception 'A conta do dono precisa ser administradora de um grupo para usar o modo espião';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and tenant_id = p_org) then raise exception 'Este é o seu próprio grupo'; end if;
  insert into public.support_sessions (user_id, org_id, expires_at) values (auth.uid(), p_org, now() + make_interval(mins => p_minutes))
  on conflict (user_id) do update set org_id = excluded.org_id, started_at = now(), expires_at = excluded.expires_at;
  perform public.sa_log(p_org, 'SA_SPY_START', jsonb_build_object('reason', left(trim(p_reason), 200), 'minutes', p_minutes));
end $$;

create function public.sa_support_stop() returns void
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  perform public.sa_guard();
  delete from public.support_sessions where user_id = auth.uid() returning org_id into o;
  if o is not null then perform public.sa_log(o, 'SA_SPY_END', '{}'::jsonb); end if;
end $$;

-- O menu do painel usa os módulos do grupo que está sendo exibido.
create or replace function public.my_modules() returns text[]
language sql stable security definer set search_path = public as $$
  select pl.modules from public.organizations o join public.plans pl on pl.id = o.plan_id where o.id = public.current_tenant()
$$;

revoke execute on function public.in_support_mode(), public.block_support_writes(), public.my_support_session(),
  public.sa_support_start(uuid, text, int), public.sa_support_stop() from public, anon;
grant execute on function public.in_support_mode(), public.my_support_session(), public.sa_support_start(uuid, text, int), public.sa_support_stop() to authenticated;
revoke execute on function public.block_support_writes() from authenticated, service_role;

-- Reversão:
--   do $$ declare t text; begin for t in select event_object_table from information_schema.triggers where trigger_name = 'a_support_readonly' loop
--     execute format('drop trigger a_support_readonly on public.%I', t); end loop; end $$;
--   drop function public.block_support_writes(), public.my_support_session(), public.sa_support_start(uuid, text, int), public.sa_support_stop(), public.in_support_mode();
--   drop table public.support_sessions;
--   (e recriar current_tenant com a definição da 0022 e my_modules com a da 0028)
