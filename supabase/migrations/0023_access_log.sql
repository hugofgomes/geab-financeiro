-- Log de acessos diários: uma linha por usuário por dia (fuso de São Paulo). Só o administrador geral da plataforma consulta.
create table public.access_log (
  day date not null,
  user_id uuid not null,
  tenant_id uuid references public.organizations(id) on delete cascade,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  hits int not null default 1,
  user_agent text,
  primary key (day, user_id)
);
create index access_log_tenant_day on public.access_log (tenant_id, day);
alter table public.access_log enable row level security;   -- sem políticas: só funções security definer acessam

-- Chamada pelo próprio app quando a pessoa abre o sistema (no máximo uma vez por aba/dia no cliente).
create function public.log_access(p_ua text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null then return; end if;
  insert into public.access_log (day, user_id, tenant_id, user_agent)
  values (d, auth.uid(), (select tenant_id from public.profiles where id = auth.uid()), left(p_ua, 200))
  on conflict (day, user_id) do update set last_at = now(), hits = public.access_log.hits + 1;
end $$;

-- Resumo por dia
create function public.sa_access_daily(p_days int default 30)
returns table (day date, users int, orgs int, hits int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sa_guard();
  return query
  select l.day, count(*)::int, count(distinct l.tenant_id)::int, sum(l.hits)::int
  from public.access_log l
  where l.day >= (now() at time zone 'America/Sao_Paulo')::date - greatest(least(p_days, 365), 1) + 1
  group by l.day order by l.day desc;
end $$;

-- Detalhe de um dia: quem acessou, de qual grupo, primeiro e último acesso
create function public.sa_access_day(p_day date)
returns table (user_id uuid, full_name text, email text, org_name text, role text, first_at timestamptz, last_at timestamptz, hits int, user_agent text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sa_guard();
  return query
  select l.user_id, p.full_name, u.email::text, o.name, p.role::text, l.first_at, l.last_at, l.hits, l.user_agent
  from public.access_log l
  left join public.profiles p on p.id = l.user_id
  left join auth.users u on u.id = l.user_id
  left join public.organizations o on o.id = l.tenant_id
  where l.day = p_day
  order by l.last_at desc
  limit 500;
end $$;

revoke all on function public.log_access(text), public.sa_access_daily(int), public.sa_access_day(date) from public, anon;
grant execute on function public.log_access(text), public.sa_access_daily(int), public.sa_access_day(date) to authenticated;
