-- Quadra Esportiva, Fase 6: página pública, busca de disponibilidade, solicitação de reserva, partidas e vagas.
-- Visitantes NÃO acessam tabelas: só as funções abaixo (sem dados privados). A disponibilidade continua com UMA fonte de verdade:
-- a reserva pública usa as mesmas regras (court_validate_window, preço, código) e a mesma restrição de exclusão do banco das reservas do painel.
-- Só adiciona. Reversão no fim do arquivo.

alter table public.court_venues
  add column public_enabled boolean not null default false,        -- o centro precisa ligar a página pública (opt-in)
  add column public_auto_confirm boolean not null default false;   -- false: a solicitação nasce PENDENTE e a equipe confirma
alter table public.court_bookings add column source text not null default 'painel' check (source in ('painel', 'publica'));
create index court_bookings_public_pending_idx on public.court_bookings (tenant_id, client_phone) where source = 'publica' and status = 'pendente';

-- ───────── Partidas (vagas para jogadores) ─────────
create table public.court_matches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.resolve_tenant() references public.organizations(id),
  booking_id uuid not null unique references public.court_bookings(id) on delete restrict,
  title text not null check (length(trim(title)) between 2 and 80),
  description text check (description is null or length(description) <= 300),
  slots_total smallint not null check (slots_total between 1 and 40),     -- vagas a preencher (sem contar o organizador)
  status text not null default 'aberta' check (status in ('aberta', 'completa', 'cancelada')),
  is_public boolean not null default true,
  manage_hash text not null,                                              -- SHA-256 do código secreto do organizador (o código em si não é guardado)
  created_at timestamptz not null default now()
);
create index court_matches_tenant_idx on public.court_matches (tenant_id, status);
create table public.court_match_players (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.resolve_tenant() references public.organizations(id),
  match_id uuid not null references public.court_matches(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 80),
  phone text not null check (phone ~ '^[0-9]{12,15}$'),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado', 'removido')),
  created_at timestamptz not null default now(),
  unique (match_id, phone)
);
do $$
declare t text;
begin
  foreach t in array array['court_matches', 'court_match_players']
  loop
    execute format('create trigger a_support_readonly before insert or update or delete on public.%I for each row execute function public.block_support_writes()', t);
    execute format('create trigger a_tenant_guard before insert or update or delete on public.%I for each row execute function public.tenant_guard()', t);
    execute format('create trigger z_audit after insert or update or delete on public.%I for each row execute function public.audit()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy court_matches_read on public.court_matches for select using (public.court_role() in ('admin', 'gerente', 'recepcionista') and tenant_id = public.current_tenant());
create policy court_match_players_read on public.court_match_players for select using (public.court_role() in ('admin', 'gerente', 'recepcionista') and tenant_id = public.current_tenant());
create trigger b_tenant_refs before insert or update on public.court_matches for each row execute function public.tenant_ref_check('booking_id:court_bookings');
create trigger b_tenant_refs before insert or update on public.court_match_players for each row execute function public.tenant_ref_check('match_id:court_matches');

-- Reserva cancelada cancela a partida vinculada (a vaga some da vitrine).
create function public.court_booking_cancel_match() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelada' and old.status <> 'cancelada' then update public.court_matches set status = 'cancelada' where booking_id = new.id and status <> 'cancelada'; end if;
  return new;
end $$;
create trigger f_cancel_match after update of status on public.court_bookings for each row execute function public.court_booking_cancel_match();

-- ───────── Apoio interno (sem execução direta) ─────────
create function public.court_public_org(p_slug text) returns uuid
language sql stable security definer set search_path = public as $$
  select o.id from public.organizations o join public.plans p on p.id = o.plan_id join public.court_venues v on v.tenant_id = o.id
  where o.slug = lower(trim(coalesce(p_slug, ''))) and o.kind = 'quadra' and v.public_enabled and 'quadras' = any (p.modules)
    and (o.status = 'ativa' or (o.status = 'teste' and o.trial_ends_at > now()))
$$;

-- Horários livres de um dia (mesma grade, funcionamento, antecedência e conflitos das reservas do painel).
create function public.court_free_slots(p_tenant uuid, p_date date, p_minutes int default null) returns table (court_id uuid, start_min int, end_min int, price_cents int)
language plpgsql stable security definer set search_path = public as $$
declare v public.court_venues; dur int; c record; h record; m int; s timestamptz; e timestamptz; own boolean; dow int; today date;
begin
  select * into v from public.court_venues x where x.tenant_id = p_tenant;
  if not found or p_date is null then return; end if;
  today := (now() at time zone v.timezone)::date;
  if p_date < today or p_date > today + v.max_advance_days then return; end if;
  dur := greatest(coalesce(p_minutes, v.min_duration_minutes), v.min_duration_minutes);
  dur := ((dur + v.slot_minutes - 1) / v.slot_minutes) * v.slot_minutes;
  dow := extract(dow from p_date)::int;
  for c in select k.* from public.court_courts k where k.tenant_id = p_tenant and k.active order by k.sort_order, k.name loop
    own := exists (select 1 from public.court_hours o where o.tenant_id = p_tenant and o.court_id = c.id and o.active);
    for h in select hh.* from public.court_hours hh where hh.tenant_id = p_tenant and hh.active and hh.weekday = dow and ((own and hh.court_id = c.id) or (not own and hh.court_id is null)) order by hh.opens_min loop
      m := ((h.opens_min + v.slot_minutes - 1) / v.slot_minutes) * v.slot_minutes;
      while m + dur <= h.closes_min loop
        s := (p_date::timestamp + make_interval(mins => m)) at time zone v.timezone; e := s + make_interval(mins => dur);
        if s >= now() + make_interval(mins => v.min_notice_minutes)
           and not exists (select 1 from public.court_bookings b where b.court_id = c.id and b.status <> 'cancelada' and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(s, e, '[)')) then
          court_id := c.id; start_min := m; end_min := m + dur; price_cents := public.court_price_for(p_tenant, c.id, s, e, 'avulsa'); return next;
        end if;
        m := m + v.slot_minutes;
      end loop;
    end loop;
  end loop;
end $$;
revoke execute on function public.court_public_org(text), public.court_free_slots(uuid, date, int) from public, anon, authenticated;

-- ───────── Funções públicas (anon) ─────────
-- Vitrine do centro: só dados feitos para o público (nunca CPF/CNPJ, razão social, equipe, clientes ou financeiro).
create function public.court_public_venue(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.court_public_org(p_slug); res jsonb;
begin
  if t is null then return null; end if;
  select jsonb_build_object(
    'slug', (select slug from public.organizations where id = t),
    'venue', (select jsonb_build_object('name', v.trade_name, 'description', v.description, 'logo_url', v.logo_url, 'phone', v.phone, 'whatsapp', v.whatsapp, 'email', v.email, 'website', v.website,
        'instagram', v.instagram, 'facebook', v.facebook, 'street', v.street, 'number', v.number, 'complement', v.complement, 'district', v.district, 'city', v.city, 'state', v.state, 'cep', v.cep,
        'latitude', v.latitude, 'longitude', v.longitude, 'timezone', v.timezone, 'slot_minutes', v.slot_minutes, 'min_duration_minutes', v.min_duration_minutes, 'min_notice_minutes', v.min_notice_minutes,
        'max_advance_days', v.max_advance_days, 'cancel_free_hours', v.cancel_free_hours, 'cancel_fee_pct', v.cancel_fee_pct, 'auto_confirm', v.public_auto_confirm) from public.court_venues v where v.tenant_id = t),
    'courts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'sport', c.sport, 'floor_type', c.floor_type, 'covered', c.covered, 'lighting', c.lighting,
        'capacity', c.capacity, 'photos', c.photos, 'price_cents', c.price_cents) order by c.sort_order, c.name) from public.court_courts c where c.tenant_id = t and c.active), '[]'),
    'prices', coalesce((select jsonb_agg(jsonb_build_object('court_id', r.court_id, 'name', r.name, 'weekdays', r.weekdays, 'from_min', r.from_min, 'to_min', r.to_min, 'price_cents', r.price_cents)) from public.court_price_rules r
        where r.tenant_id = t and r.active and (r.kind is null or r.kind = 'avulsa')), '[]'),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('court_id', h.court_id, 'weekday', h.weekday, 'opens_min', h.opens_min, 'closes_min', h.closes_min)) from public.court_hours h where h.tenant_id = t and h.active), '[]')
  ) into res;
  return res;
end $$;

create function public.court_public_availability(p_slug text, p_date date, p_minutes int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.court_public_org(p_slug);
begin
  if t is null then return null; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('court_id', f.court_id, 'start_min', f.start_min, 'end_min', f.end_min, 'price_cents', f.price_cents) order by f.start_min, f.court_id)
    from public.court_free_slots(t, p_date, p_minutes) f), '[]');
end $$;

-- Solicitação de reserva (jogador/organizador, sem login). Nasce PENDENTE, salvo se o centro ligou a confirmação automática.
-- Opcionalmente cria a partida com vagas e devolve o código secreto do organizador (mostrado uma única vez).
create function public.court_public_request(p_slug text, p_court uuid, p_start timestamptz, p_end timestamptz, p_name text, p_phone text, p_sport text default null, p_notes text default null,
  p_match_slots int default null, p_match_title text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t uuid := public.court_public_org(p_slug); v public.court_venues; ph text; nm text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'); b public.court_bookings; price int; st text; dur int; sp text;
  token text; mt public.court_matches;
begin
  if t is null then raise exception 'Centro esportivo não encontrado'; end if;
  select * into v from public.court_venues where tenant_id = t;
  if length(nm) < 2 or length(nm) > 120 then raise exception 'Informe o seu nome'; end if;
  ph := public.court_norm_phone(p_phone);
  if ph is null then raise exception 'Informe o telefone com DDD'; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'Horário inválido'; end if;
  dur := (extract(epoch from (p_end - p_start)) / 60)::int;
  if dur > 240 then raise exception 'A reserva online é limitada a 4 horas'; end if;
  if p_start < now() + make_interval(mins => v.min_notice_minutes) then raise exception 'Este horário exige antecedência mínima maior'; end if;
  if p_start > now() + make_interval(days => v.max_advance_days) then raise exception 'Reservas online só até % dia(s) à frente', v.max_advance_days; end if;
  -- freio contra abuso: poucas solicitações pendentes por telefone e teto por estabelecimento
  if (select count(*) from public.court_bookings x where x.tenant_id = t and x.source = 'publica' and x.client_phone = ph and x.status = 'pendente' and x.starts_at > now()) >= 3 then
    raise exception 'Você já tem solicitações aguardando confirmação. Aguarde o retorno do centro.';
  end if;
  if (select count(*) from public.court_bookings x where x.tenant_id = t and x.source = 'publica' and x.status = 'pendente' and x.starts_at > now()) >= 100 then
    raise exception 'O centro recebeu muitas solicitações no momento. Tente mais tarde ou fale pelo WhatsApp.';
  end if;
  if p_match_slots is not null and (p_match_slots < 1 or p_match_slots > 40) then raise exception 'Vagas da partida: de 1 a 40'; end if;
  perform public.court_validate_window(t, p_court, p_start, p_end, 'avulsa', 'publico');
  price := public.court_price_for(t, p_court, p_start, p_end, 'avulsa');
  select coalesce(case when p_sport in ('futebol_society', 'futsal', 'futebol_campo', 'volei', 'volei_praia', 'beach_tennis', 'basquete', 'tenis', 'padel', 'outra') then p_sport end, c.sport) into sp from public.court_courts c where c.id = p_court;
  st := case when v.public_auto_confirm then 'confirmada' else 'pendente' end;
  begin
    insert into public.court_bookings (tenant_id, court_id, code, kind, client_name, client_phone, sport, starts_at, ends_at, price_cents, payment_status, status, notes, source)
    values (t, p_court, public.court_next_code(t), 'avulsa', nm, ph, sp, p_start, p_end, price, 'em_aberto', st, left('Solicitação pelo site' || coalesce(' · ' || nullif(trim(coalesce(p_notes, '')), ''), ''), 500), 'publica') returning * into b;
  exception when exclusion_violation then raise exception 'Horário indisponível: acabou de ser reservado. Escolha outro horário.';
  end;
  if p_match_slots is not null then
    token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.court_matches (tenant_id, booking_id, title, slots_total, manage_hash)
    values (t, b.id, coalesce(nullif(trim(coalesce(p_match_title, '')), ''), 'Partida de ' || split_part(nm, ' ', 1)), p_match_slots, encode(sha256(convert_to(token, 'UTF8')), 'hex')) returning * into mt;
  end if;
  return jsonb_build_object('code', b.code, 'status', b.status, 'price_cents', b.price_cents, 'manage_token', token);
end $$;

-- Partidas abertas do centro (só confirmadas e futuras): nome, quadra, horário e vagas. Nenhum telefone.
create function public.court_public_matches(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.court_public_org(p_slug);
begin
  if t is null then return null; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at) from (
    select m.id, m.title, m.description, c.name court, b.sport, b.starts_at, b.ends_at, m.slots_total,
           (select count(*) from public.court_match_players p where p.match_id = m.id and p.status = 'aprovado') approved
    from public.court_matches m join public.court_bookings b on b.id = m.booking_id join public.court_courts c on c.id = b.court_id
    where m.tenant_id = t and m.status = 'aberta' and m.is_public and b.status = 'confirmada' and b.starts_at > now() order by b.starts_at limit 30) x), '[]');
end $$;

-- Jogador pede uma vaga (o organizador aprova).
create function public.court_public_match_join(p_match uuid, p_name text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.court_matches; ph text := public.court_norm_phone(p_phone); nm text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'); appr int;
begin
  select m2.* into m from public.court_matches m2 join public.court_bookings b on b.id = m2.booking_id
    where m2.id = p_match and m2.status = 'aberta' and m2.is_public and b.status = 'confirmada' and b.starts_at > now() and public.court_venue_is_public(m2.tenant_id) for update of m2;
  if not found then raise exception 'Esta partida não está mais aberta'; end if;
  if length(nm) < 2 or length(nm) > 80 then raise exception 'Informe o seu nome'; end if;
  if ph is null then raise exception 'Informe o telefone com DDD'; end if;
  select count(*) into appr from public.court_match_players where match_id = m.id and status = 'aprovado';
  if appr >= m.slots_total then raise exception 'Partida completa'; end if;
  if (select count(*) from public.court_match_players where match_id = m.id and status = 'pendente') >= 60 then raise exception 'Muitos pedidos pendentes nesta partida'; end if;
  begin
    insert into public.court_match_players (tenant_id, match_id, name, phone) values (m.tenant_id, m.id, nm, ph);
  exception when unique_violation then raise exception 'Você já pediu vaga nesta partida';
  end;
end $$;
create function public.court_venue_is_public(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$ select public.court_public_org((select slug from public.organizations where id = p_tenant)) is not null $$;
revoke execute on function public.court_venue_is_public(uuid) from public, anon, authenticated;

-- Organizador (com o código secreto): vê e decide os pedidos.
create function public.court_match_token_row(p_token text) returns public.court_matches
language sql stable security definer set search_path = public as $$
  select m.* from public.court_matches m where m.manage_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;
revoke execute on function public.court_match_token_row(text) from public, anon, authenticated;

create function public.court_match_manage_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.court_matches := public.court_match_token_row(p_token);
begin
  if m.id is null then return null; end if;
  return jsonb_build_object('id', m.id, 'title', m.title, 'description', m.description, 'status', m.status, 'slots_total', m.slots_total,
    'booking', (select jsonb_build_object('code', b.code, 'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'court', c.name, 'venue', v.trade_name, 'timezone', v.timezone, 'whatsapp', v.whatsapp,
        'slug', (select slug from public.organizations where id = m.tenant_id))
      from public.court_bookings b join public.court_courts c on c.id = b.court_id join public.court_venues v on v.tenant_id = b.tenant_id where b.id = m.booking_id),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone, 'status', p.status) order by p.created_at) from public.court_match_players p where p.match_id = m.id), '[]'));
end $$;

create function public.court_match_manage_decide(p_token text, p_player uuid, p_decision text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.court_matches; appr int; pl public.court_match_players;
begin
  m := public.court_match_token_row(p_token);
  if m.id is null then raise exception 'Código inválido'; end if;
  select * into m from public.court_matches where id = m.id for update;
  if m.status = 'cancelada' then raise exception 'Partida cancelada'; end if;
  if p_decision not in ('aprovado', 'recusado', 'removido') then raise exception 'Decisão inválida'; end if;
  select * into pl from public.court_match_players where id = p_player and match_id = m.id for update;
  if not found then raise exception 'Jogador não encontrado'; end if;
  if p_decision = 'aprovado' then
    select count(*) into appr from public.court_match_players where match_id = m.id and status = 'aprovado' and id <> pl.id;
    if appr >= m.slots_total then raise exception 'Todas as vagas já foram preenchidas'; end if;
  end if;
  update public.court_match_players set status = p_decision where id = pl.id;
  select count(*) into appr from public.court_match_players where match_id = m.id and status = 'aprovado';
  update public.court_matches set status = case when appr >= slots_total then 'completa' else 'aberta' end where id = m.id;
end $$;

create function public.court_match_manage_cancel(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.court_matches := public.court_match_token_row(p_token);
begin
  if m.id is null then raise exception 'Código inválido'; end if;
  update public.court_matches set status = 'cancelada' where id = m.id;
end $$;

-- Busca de centros (jogador): modalidade, cidade/estado e, opcionalmente, dia e faixa de horário com vaga livre.
create function public.court_public_search(p_sport text default null, p_city text default null, p_state text default null, p_date date default null, p_from_min int default null, p_to_min int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o record; res jsonb := '[]'::jsonb; free int; sports text[]; minp int; n int := 0;
begin
  for o in select og.id, og.slug, v.trade_name, v.city, v.state, v.logo_url from public.organizations og join public.court_venues v on v.tenant_id = og.id
           where public.court_public_org(og.slug) is not null
             and (nullif(trim(coalesce(p_city, '')), '') is null or lower(coalesce(v.city, '')) like '%' || lower(trim(p_city)) || '%')
             and (nullif(trim(coalesce(p_state, '')), '') is null or v.state = upper(trim(p_state))) order by v.trade_name limit 200 loop
    select array_agg(distinct c.sport), min(c.price_cents) into sports, minp from public.court_courts c where c.tenant_id = o.id and c.active and (nullif(p_sport, '') is null or c.sport = p_sport);
    continue when sports is null;
    free := null;
    if p_date is not null then
      select count(*) into free from public.court_free_slots(o.id, p_date) f join public.court_courts c on c.id = f.court_id
        where (nullif(p_sport, '') is null or c.sport = p_sport) and (p_from_min is null or f.start_min >= p_from_min) and (p_to_min is null or f.start_min < p_to_min);
      continue when free = 0;
    end if;
    res := res || jsonb_build_object('slug', o.slug, 'name', o.trade_name, 'city', o.city, 'state', o.state, 'logo_url', o.logo_url, 'sports', to_jsonb(sports), 'min_price_cents', minp, 'free_slots', free);
    n := n + 1; exit when n >= 60;
  end loop;
  return res;
end $$;

do $$
declare f text;
begin
  foreach f in array array['court_public_venue(text)', 'court_public_availability(text, date, int)', 'court_public_request(text, uuid, timestamptz, timestamptz, text, text, text, text, int, text)',
    'court_public_matches(text)', 'court_public_match_join(uuid, text, text)', 'court_match_manage_get(text)', 'court_match_manage_decide(text, uuid, text)', 'court_match_manage_cancel(text)',
    'court_public_search(text, text, text, date, int, int)']
  loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- Reversão:
--   drop function public.court_public_search(text, text, text, date, int, int), public.court_match_manage_cancel(text), public.court_match_manage_decide(text, uuid, text), public.court_match_manage_get(text),
--     public.court_match_token_row(text), public.court_public_match_join(uuid, text, text), public.court_venue_is_public(uuid), public.court_public_matches(text),
--     public.court_public_request(text, uuid, timestamptz, timestamptz, text, text, text, text, int, text), public.court_public_availability(text, date, int), public.court_public_venue(text),
--     public.court_free_slots(uuid, date, int), public.court_public_org(text), public.court_booking_cancel_match();
--   drop table public.court_match_players, public.court_matches; alter table public.court_bookings drop column source;
--   alter table public.court_venues drop column public_enabled, drop column public_auto_confirm;
