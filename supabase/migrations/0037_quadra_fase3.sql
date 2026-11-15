-- Quadra Esportiva, Fase 3: clientes (CRM), lista de espera e gestão de funcionários.
-- Só adiciona. Reversão no fim do arquivo.

-- Função pura (só formata telefone): os gatilhos de validação rodam com o usuário e precisam executá-la.
grant execute on function public.court_norm_phone(text) to authenticated;

-- ───────── Clientes ─────────
create table public.court_clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.resolve_tenant() references public.organizations(id),
  name text not null check (length(trim(name)) between 2 and 120),
  phone text check (phone is null or phone ~ '^[0-9]{12,15}$'),            -- sempre normalizado com DDI (55...)
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{12,15}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  birth_date date check (birth_date is null or (birth_date > date '1900-01-01' and birth_date <= current_date)),
  favorite_sport text check (favorite_sport is null or favorite_sport in ('futebol_society', 'futsal', 'futebol_campo', 'volei', 'volei_praia', 'beach_tennis', 'basquete', 'tenis', 'padel', 'outra')),
  client_type text not null default 'avulso' check (client_type in ('avulso', 'mensalista', 'professor', 'organizador', 'outros')),
  notes text check (notes is null or length(notes) <= 500),
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  birthday_consent boolean not null default false,                          -- LGPD: só exibe aniversário no painel com autorização
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index court_clients_phone_uniq on public.court_clients (tenant_id, phone) where phone is not null;
create index court_clients_tenant_idx on public.court_clients (tenant_id, status);

create function public.court_client_validate() returns trigger
language plpgsql as $$
begin
  new.name := regexp_replace(trim(new.name), '\s+', ' ', 'g');
  new.phone := public.court_norm_phone(new.phone);
  new.whatsapp := public.court_norm_phone(new.whatsapp);
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  new.updated_at := now();
  return new;
end $$;

-- Reservas e séries passam a apontar para o cliente (ligação automática pelo telefone, no servidor).
alter table public.court_bookings add column client_id uuid references public.court_clients(id) on delete restrict;
alter table public.court_series add column client_id uuid references public.court_clients(id) on delete restrict;
create index court_bookings_client_idx on public.court_bookings (client_id) where client_id is not null;

create function public.court_booking_link_client() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is null and new.client_phone is not null then
    select c.id into new.client_id from public.court_clients c where c.tenant_id = new.tenant_id and c.phone = new.client_phone limit 1;
  end if;
  return new;
end $$;
create trigger d_client_link before insert on public.court_bookings for each row execute function public.court_booking_link_client();
create trigger d_client_link before insert on public.court_series for each row execute function public.court_booking_link_client();

-- ───────── Lista de espera ─────────
create table public.court_waitlist (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.resolve_tenant() references public.organizations(id),
  name text not null check (length(trim(name)) between 2 and 120),
  phone text check (phone is null or phone ~ '^[0-9]{12,15}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  sport text check (sport is null or sport in ('futebol_society', 'futsal', 'futebol_campo', 'volei', 'volei_praia', 'beach_tennis', 'basquete', 'tenis', 'padel', 'outra')),
  court_id uuid references public.court_courts(id) on delete set null,
  weekday smallint check (weekday is null or weekday between 0 and 6),     -- 0 = domingo; nulo = qualquer dia
  start_min smallint check (start_min is null or start_min between 0 and 1439),
  kind text not null default 'avulsa' check (kind in ('avulsa', 'mensalista', 'mensalista_professor')),
  notes text check (notes is null or length(notes) <= 500),
  status text not null default 'aguardando' check (status in ('aguardando', 'avisado', 'atendido', 'cancelado')),
  contact_consent boolean not null default false,                           -- cliente autorizou ser avisado
  notified_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);
create index court_waitlist_tenant_idx on public.court_waitlist (tenant_id, status);

create function public.court_waitlist_validate() returns trigger
language plpgsql as $$
begin
  new.name := regexp_replace(trim(new.name), '\s+', ' ', 'g');
  new.phone := public.court_norm_phone(new.phone);
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  if new.phone is null and new.email is null then raise exception 'Informe telefone ou e-mail'; end if;
  new.updated_at := now();
  return new;
end $$;

-- ───────── Proteções, auditoria e acesso ─────────
do $$
declare t text;
begin
  foreach t in array array['court_clients', 'court_waitlist']
  loop
    execute format('create trigger a_support_readonly before insert or update or delete on public.%I for each row execute function public.block_support_writes()', t);
    execute format('create trigger a_tenant_guard before insert or update or delete on public.%I for each row execute function public.tenant_guard()', t);
    execute format('create trigger z_audit after insert or update or delete on public.%I for each row execute function public.audit()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
create trigger b_tenant_refs before insert or update on public.court_waitlist for each row execute function public.tenant_ref_check('court_id:court_courts');
create trigger c_validate before insert or update on public.court_clients for each row execute function public.court_client_validate();
create trigger c_validate before insert or update on public.court_waitlist for each row execute function public.court_waitlist_validate();

-- Clientes: leitura por toda a equipe; escrita por administrador, gerente e recepcionista; exclusão só administrador/gerente e só sem reservas (FK restrict).
create policy court_clients_read on public.court_clients for select using (public.court_role() is not null and tenant_id = public.current_tenant());
create policy court_clients_ins on public.court_clients for insert with check (public.court_role() in ('admin', 'gerente', 'recepcionista') and tenant_id = public.current_tenant());
create policy court_clients_upd on public.court_clients for update using (public.court_role() in ('admin', 'gerente', 'recepcionista') and tenant_id = public.current_tenant())
  with check (public.court_role() in ('admin', 'gerente', 'recepcionista') and tenant_id = public.current_tenant());
create policy court_clients_del on public.court_clients for delete using (public.court_role() in ('admin', 'gerente') and tenant_id = public.current_tenant());
-- Lista de espera: financeiro não vê (dados de contato sem necessidade).
create policy court_waitlist_read on public.court_waitlist for select using (public.court_role() in ('admin', 'gerente', 'recepcionista') and tenant_id = public.current_tenant());
create policy court_waitlist_write on public.court_waitlist for all using (public.court_role() in ('admin', 'gerente', 'recepcionista') and tenant_id = public.current_tenant())
  with check (public.court_role() in ('admin', 'gerente', 'recepcionista') and tenant_id = public.current_tenant());

-- Horários livres que combinam com a lista de espera (próximos p_days dias). NÃO reserva nada: a lista de espera não garante reserva (regra 9).
create function public.court_waitlist_matches(p_days int default 14) returns table (waitlist_id uuid, court_id uuid, court_name text, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_tenant(); tz text; mind int; today date; w record; c record; d date; s timestamptz; e timestamptz;
begin
  perform public.court_require(array['admin', 'gerente', 'recepcionista']);
  select v.timezone, v.min_duration_minutes into tz, mind from public.court_venues v where v.tenant_id = t;
  if tz is null then return; end if;
  today := (now() at time zone tz)::date;
  for w in select * from public.court_waitlist x where x.tenant_id = t and x.status = 'aguardando' and x.start_min is not null loop
    for c in select * from public.court_courts k where k.tenant_id = t and k.active and (w.court_id is null or k.id = w.court_id) and (w.sport is null or k.sport = w.sport) loop
      for d in select (today + g)::date from generate_series(0, least(greatest(p_days, 1), 60)) g where w.weekday is null or extract(dow from (today + g)::date)::int = w.weekday loop
        s := (d::timestamp + make_interval(mins => w.start_min)) at time zone tz;
        e := s + make_interval(mins => mind);
        continue when s <= now();
        continue when exists (select 1 from public.court_bookings b where b.court_id = c.id and b.status <> 'cancelada' and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(s, e, '[)'));
        begin
          perform public.court_validate_window(t, c.id, s, e, w.kind, 'recepcionista');
        exception when others then continue;
        end;
        waitlist_id := w.id; court_id := c.id; court_name := c.name; starts_at := s; ends_at := e;
        return next;
      end loop;
    end loop;
  end loop;
end $$;
revoke execute on function public.court_waitlist_matches(int) from public, anon;
grant execute on function public.court_waitlist_matches(int) to authenticated;

-- Registra que o interessado foi avisado (manual, por link de WhatsApp). Sem envio automático.
create function public.court_waitlist_mark(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.court_require(array['admin', 'gerente', 'recepcionista']);
  if p_status not in ('aguardando', 'avisado', 'atendido', 'cancelado') then raise exception 'Situação inválida'; end if;
  update public.court_waitlist set status = p_status, notified_at = case when p_status = 'avisado' then now() else notified_at end
    where id = p_id and tenant_id = public.current_tenant();
  if not found then raise exception 'Solicitação não encontrada'; end if;
end $$;
revoke execute on function public.court_waitlist_mark(uuid, text) from public, anon;
grant execute on function public.court_waitlist_mark(uuid, text) to authenticated;

-- ───────── Funcionários ─────────
-- Equipe do estabelecimento (com e-mail), para a tela de funcionários. Só o administrador enxerga a lista completa; o e-mail vem de auth.users.
create function public.court_staff_list() returns table (profile_id uuid, full_name text, email text, role text, job_position text, active boolean, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.court_require(array['admin']);
  return query
    select s.profile_id, p.full_name, u.email::text, s.role, s.position, (s.active and p.active), s.created_at, u.last_sign_in_at
    from public.court_staff s join public.profiles p on p.id = s.profile_id and p.tenant_id = s.tenant_id join auth.users u on u.id = s.profile_id
    where s.tenant_id = public.current_tenant() order by p.full_name;
end $$;
revoke execute on function public.court_staff_list() from public, anon;
grant execute on function public.court_staff_list() to authenticated;

-- Atualiza cargo/perfil/situação de um funcionário (bloquear = active false: perde o acesso ao módulo e ao sistema, sem apagar histórico).
create function public.court_staff_update(p_profile uuid, p_role text, p_position text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.court_require(array['admin']);
  if p_role not in ('gerente', 'recepcionista', 'financeiro') then raise exception 'Perfil inválido'; end if;
  update public.court_staff set role = p_role, position = nullif(trim(coalesce(p_position, '')), ''), active = p_active
    where profile_id = p_profile and tenant_id = public.current_tenant();
  if not found then raise exception 'Funcionário não encontrado'; end if;
  update public.profiles set active = p_active where id = p_profile and tenant_id = public.current_tenant();
end $$;
revoke execute on function public.court_staff_update(uuid, text, text, boolean) from public, anon;
grant execute on function public.court_staff_update(uuid, text, text, boolean) to authenticated;

-- Reversão:
--   drop function public.court_staff_update(uuid, text, text, boolean), public.court_staff_list(), public.court_waitlist_mark(uuid, text), public.court_waitlist_matches(int),
--     public.court_waitlist_validate(), public.court_booking_link_client(), public.court_client_validate();
--   alter table public.court_bookings drop column client_id; alter table public.court_series drop column client_id;
--   drop table public.court_waitlist, public.court_clients;
