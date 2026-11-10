-- ════════════════════════════════════════════════════════════════════════════════════════════
-- GEAB Futebol SaaS — Etapa 1: base multi-tenant (organizações).
-- Os dados atuais passam a pertencer à organização "geab". Nada é apagado.
--
-- Defesa em camadas:
--   1) RLS: toda política exige tenant_id = current_tenant().
--   2) tenant_guard: gatilho que barra escrita em linha de outra organização (vale também para funções
--      SECURITY DEFINER, que ignoram RLS) e impede trocar o tenant_id de uma linha.
--   3) tenant_ref_check: uma linha não pode apontar (atleta, jogo, mensalidade…) para registro de outra organização.
--   4) Funções que LEEM (artilharia, aniversários, usuários) filtram por organização explicitamente.
-- Servidor (service_role) NÃO tem organização do usuário: precisa informar tenant_id. Enquanto existir uma única
-- organização, resolve_tenant() usa ela; com 2 ou mais, a omissão falha de propósito (nunca grava no grupo errado).
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ───────── Organizações ─────────
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),   -- subdomínio: slug.plataforma.com.br
  name text not null check (length(trim(name)) between 1 and 80),
  logo_url text,
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  status text not null default 'ativa' check (status in ('teste', 'ativa', 'suspensa', 'cancelada')),
  created_at timestamptz not null default now()
);
insert into public.organizations (slug, name) values ('geab', 'GEAB Futebol');

-- ───────── tenant_id em todas as tabelas (dados atuais → organização geab) ─────────
do $$
declare geab uuid := (select id from public.organizations where slug = 'geab'); t text;
begin
  foreach t in array array['athletes','profiles','charges','payments','expenses','audit_log','notifications','other_income',
                           'signup_requests','matches','match_players','match_lineups','pix_charges','app_settings','btg_connection']
  loop
    execute format('alter table public.%I add column tenant_id uuid references public.organizations(id)', t);
    execute format('alter table public.%I disable trigger user', t);          -- o backfill não gera auditoria
    execute format('update public.%I set tenant_id = $1', t) using geab;
    execute format('alter table public.%I enable trigger user', t);
    execute format('alter table public.%I alter column tenant_id set not null', t);
    execute format('create index %I on public.%I (tenant_id)', t || '_tenant_idx', t);
  end loop;
end $$;

-- ───────── Funções de organização ─────────
-- Organização do usuário logado (nula se não houver perfil ativo).
create function public.current_tenant() returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from public.profiles where id = auth.uid() and active
$$;

-- A única organização existente (nula se houver 0 ou 2+). Só serve de transição para rotas de servidor.
create function public.default_tenant() returns uuid
language sql stable security definer set search_path = public as $$
  select case when (select count(*) from public.organizations) = 1 then (select id from public.organizations limit 1) end
$$;

create function public.resolve_tenant() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_tenant(), public.default_tenant())
$$;

do $$
declare t text;
begin
  foreach t in array array['athletes','profiles','charges','payments','expenses','audit_log','notifications','other_income',
                           'signup_requests','matches','match_players','match_lineups','pix_charges','app_settings','btg_connection']
  loop
    execute format('alter table public.%I alter column tenant_id set default public.resolve_tenant()', t);
  end loop;
end $$;

-- ───────── Chaves únicas passam a valer por organização ─────────
drop index public.payments_bank_txid_uniq;
create unique index payments_bank_txid_uniq on public.payments (tenant_id, bank_txid) where bank_txid is not null;

alter table public.app_settings drop constraint app_settings_pkey;
alter table public.app_settings add primary key (tenant_id, key);

alter table public.btg_connection drop constraint btg_connection_id_check;
alter table public.btg_connection drop constraint btg_connection_pkey;
alter table public.btg_connection add primary key (tenant_id);

-- ───────── Proteções por gatilho ─────────
create function public.tenant_guard() returns trigger
language plpgsql as $$
declare mine uuid := public.current_tenant(); rowt uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
begin
  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'A organização de um registro não pode ser alterada';
  end if;
  if auth.uid() is not null and mine is not null and rowt is distinct from mine then
    raise exception 'Operação fora da organização do usuário';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Argumentos: 'coluna:tabela'. Exige que o registro referenciado pertença à mesma organização.
create function public.tenant_ref_check() returns trigger
language plpgsql as $$
declare a text; col text; tbl text; v text; t uuid; j jsonb := to_jsonb(new);
begin
  foreach a in array tg_argv loop
    col := split_part(a, ':', 1); tbl := split_part(a, ':', 2); v := j ->> col;
    if v is not null then
      execute format('select tenant_id from public.%I where id = $1', tbl) into t using v::uuid;
      if t is distinct from new.tenant_id then raise exception 'Referência a registro de outra organização (%)', col; end if;
    end if;
  end loop;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['athletes','profiles','charges','payments','expenses','notifications','other_income',
                           'signup_requests','matches','match_players','match_lineups','pix_charges','app_settings','btg_connection']
  loop
    execute format('create trigger a_tenant_guard before insert or update or delete on public.%I for each row execute function public.tenant_guard()', t);
  end loop;
end $$;

create trigger b_tenant_refs before insert or update on public.charges        for each row execute function public.tenant_ref_check('athlete_id:athletes');
create trigger b_tenant_refs before insert or update on public.payments       for each row execute function public.tenant_ref_check('athlete_id:athletes', 'charge_id:charges');
create trigger b_tenant_refs before insert or update on public.notifications  for each row execute function public.tenant_ref_check('athlete_id:athletes', 'charge_id:charges');
create trigger b_tenant_refs before insert or update on public.pix_charges    for each row execute function public.tenant_ref_check('athlete_id:athletes', 'charge_id:charges');
create trigger b_tenant_refs before insert or update on public.match_players  for each row execute function public.tenant_ref_check('match_id:matches', 'athlete_id:athletes');
create trigger b_tenant_refs before insert or update on public.match_lineups  for each row execute function public.tenant_ref_check('match_id:matches', 'athlete_id:athletes');
create trigger b_tenant_refs before insert or update on public.profiles       for each row execute function public.tenant_ref_check('athlete_id:athletes');
create trigger b_tenant_refs before insert or update on public.signup_requests for each row execute function public.tenant_ref_check('athlete_id:athletes');

-- ───────── Políticas de acesso (RLS) ─────────
drop policy athletes_admin on public.athletes;           drop policy athletes_self on public.athletes;
drop policy profiles_admin on public.profiles;           drop policy profiles_self on public.profiles;
drop policy charges_admin on public.charges;             drop policy charges_self on public.charges;
drop policy payments_admin on public.payments;           drop policy payments_self on public.payments;
drop policy expenses_admin on public.expenses;           drop policy audit_admin on public.audit_log;
drop policy notifications_admin on public.notifications; drop policy other_income_admin on public.other_income;
drop policy signup_admin on public.signup_requests;      drop policy signup_self on public.signup_requests;
drop policy matches_admin on public.matches;             drop policy matches_member on public.matches;
drop policy match_players_admin on public.match_players; drop policy match_players_member on public.match_players;
drop policy match_lineups_admin on public.match_lineups; drop policy match_lineups_member on public.match_lineups;
drop policy pix_charges_admin on public.pix_charges;     drop policy pix_charges_self on public.pix_charges;
drop policy app_settings_admin on public.app_settings;   drop policy app_settings_member on public.app_settings;

do $$
declare t text;
begin
  -- Diretoria: tudo, mas só da própria organização.
  foreach t in array array['athletes','profiles','charges','payments','expenses','notifications','other_income',
                           'signup_requests','matches','match_players','match_lineups','pix_charges','app_settings']
  loop
    execute format('create policy %I on public.%I for all using (public.is_admin() and tenant_id = public.current_tenant()) with check (public.is_admin() and tenant_id = public.current_tenant())', t || '_admin', t);
  end loop;
  -- Qualquer usuário ativo da organização lê.
  foreach t in array array['matches','match_players','match_lineups','app_settings']
  loop
    execute format('create policy %I on public.%I for select using (public.is_member() and tenant_id = public.current_tenant())', t || '_member', t);
  end loop;
end $$;

create policy audit_admin on public.audit_log for select using (public.is_admin() and tenant_id = public.current_tenant());

-- O atleta vê só o que é dele (e sempre dentro da própria organização).
create policy athletes_self on public.athletes for select using (id = public.my_athlete() and tenant_id = public.current_tenant());
create policy profiles_self on public.profiles for select using (id = auth.uid());
create policy charges_self on public.charges for select using (athlete_id = public.my_athlete() and tenant_id = public.current_tenant());
create policy payments_self on public.payments for select using (athlete_id = public.my_athlete() and tenant_id = public.current_tenant());
create policy signup_self on public.signup_requests for select using (user_id = auth.uid());
create policy pix_charges_self on public.pix_charges for select using (athlete_id = public.my_athlete() and tenant_id = public.current_tenant());

alter table public.organizations enable row level security;
create policy organizations_own on public.organizations for select using (id = public.current_tenant());

-- ───────── Funções existentes, agora com organização ─────────
create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
  values ((r ->> 'tenant_id')::uuid, auth.uid(), tg_op, tg_table_name, coalesce(r ->> 'id', ''), r);
  return null;
end $$;

create or replace function public.generate_charges(p_competence date) returns int
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_competence)::date; n int; tn uuid := public.current_tenant();
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  insert into public.charges (tenant_id, athlete_id, competence, due_date, amount)
  select a.tenant_id, a.id, m, m + (a.due_day - 1), a.monthly_fee
  from public.athletes a
  where a.tenant_id = tn and a.active and a.joined_at < (m + interval '1 month')::date
  on conflict (athlete_id, competence) do nothing;
  get diagnostics n = row_count;
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
    values (tn, auth.uid(), 'GENERATE', 'charges', m::text, jsonb_build_object('created', n));
  return n;
end $$;

-- Cadastro público: a organização vem do metadado tenant_slug (ou da única organização, na transição).
create or replace function public.handle_signup_form() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); nm text; tn uuid;
begin
  if coalesce(m->>'signup_form', '') <> 'true' then return new; end if;
  tn := coalesce((select id from public.organizations where slug = m->>'tenant_slug' and status in ('teste', 'ativa')),
                 case when coalesce(m->>'tenant_slug', '') = '' then public.default_tenant() end);
  if tn is null then return new; end if;   -- organização desconhecida: não cria solicitação
  nm := left(trim(coalesce(m->>'full_name', '')), 120);
  insert into public.signup_requests (tenant_id, user_id, email, full_name, nickname, phone, whatsapp_consent, birth_date)
  values (tn, new.id, new.email,
          case when nm = '' then new.email else nm end,
          nullif(left(trim(coalesce(m->>'nickname', '')), 60), ''),
          nullif(left(regexp_replace(coalesce(m->>'phone', ''), '\D', '', 'g'), 15), ''),
          coalesce(m->>'whatsapp_consent', '') = 'true',
          public.safe_date(m->>'birth_date'))
  on conflict (user_id) do nothing;
  return new;
end $$;

create or replace function public.approve_signup(p_request uuid, p_athlete uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.signup_requests; aid uuid; tn uuid := public.current_tenant();
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  select * into r from public.signup_requests where id = p_request and tenant_id = tn for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if r.status <> 'pendente' then raise exception 'Esta solicitação já foi decidida'; end if;
  if exists (select 1 from public.profiles where id = r.user_id) then
    raise exception 'Este usuário já possui perfil de acesso';
  end if;

  if p_athlete is null then
    insert into public.athletes (tenant_id, full_name, nickname, phone, email, whatsapp_consent, birth_date)
    values (tn, r.full_name, r.nickname, r.phone, r.email, r.whatsapp_consent, r.birth_date)
    returning id into aid;
  else
    aid := p_athlete;
    if not exists (select 1 from public.athletes where id = aid and tenant_id = tn) then raise exception 'Atleta não encontrado'; end if;
    if exists (select 1 from public.profiles where athlete_id = aid) then
      raise exception 'Este atleta já tem um acesso vinculado a outro usuário';
    end if;
    update public.athletes set
      phone = coalesce(nullif(phone, ''), r.phone),
      email = coalesce(nullif(email, ''), r.email),
      birth_date = coalesce(birth_date, r.birth_date),
      whatsapp_consent = whatsapp_consent or r.whatsapp_consent
    where id = aid and tenant_id = tn;
  end if;

  insert into public.profiles (tenant_id, id, full_name, role, athlete_id, active)
  values (tn, r.user_id, r.full_name, 'atleta', aid, true);

  update public.signup_requests set status = 'aprovado', athlete_id = aid, decided_at = now(), decided_by = auth.uid()
  where id = r.id;
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
  values (tn, auth.uid(), 'APPROVE_SIGNUP', 'signup_requests', r.id::text, jsonb_build_object('athlete_id', aid, 'email', r.email));
  return aid;
end $$;

create or replace function public.reject_signup(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.signup_requests; tn uuid := public.current_tenant();
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  select * into r from public.signup_requests where id = p_request and tenant_id = tn for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if r.status <> 'pendente' then raise exception 'Esta solicitação já foi decidida'; end if;
  update public.signup_requests set status = 'recusado', decided_at = now(), decided_by = auth.uid() where id = r.id;
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
  values (tn, auth.uid(), 'REJECT_SIGNUP', 'signup_requests', r.id::text, jsonb_build_object('email', r.email));
end $$;

-- Cada organização precisa de pelo menos um administrador ativo (a regra é por organização).
create or replace function public.guard_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id and tenant_id = old.tenant_id) then
    raise exception 'O sistema precisa ter pelo menos um usuário da Diretoria ativo';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.admin_users() returns table (
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
    where p.tenant_id = public.current_tenant()
    order by (p.role = 'admin') desc, p.full_name;
end $$;

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
  if p_role = 'atleta' and p_athlete is null then raise exception 'Usuário atleta precisa estar vinculado a um atleta'; end if;
  if p_athlete is not null and not exists (select 1 from public.athletes where id = p_athlete and tenant_id = tn) then
    raise exception 'Atleta não encontrado';
  end if;
  if p_athlete is not null and exists (select 1 from public.profiles where athlete_id = p_athlete and id <> p_user) then
    raise exception 'Este atleta já está vinculado a outro usuário';
  end if;
  update public.profiles set full_name = nm, role = p_role, active = p_active,
         athlete_id = case when p_role = 'admin' then null else p_athlete end
   where id = p_user and tenant_id = tn;
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
  values (tn, auth.uid(), 'UPDATE_USER', 'profiles', p_user::text,
          jsonb_build_object('role', p_role, 'active', p_active, 'athlete_id', p_athlete));
end $$;

create or replace function public.admin_remove_access(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tn uuid := public.current_tenant();
begin
  if not public.is_admin() then raise exception 'Apenas a Diretoria'; end if;
  if p_user = auth.uid() then raise exception 'Você não pode remover o seu próprio acesso'; end if;
  delete from public.profiles where id = p_user and tenant_id = tn;
  if not found then raise exception 'Usuário não encontrado'; end if;
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
  values (tn, auth.uid(), 'REMOVE_ACCESS', 'profiles', p_user::text, '{}'::jsonb);
end $$;

create or replace function public.admin_delete_athlete(p_athlete uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.athletes; tn uuid := public.current_tenant();
begin
  if not public.is_admin() then raise exception 'Apenas a Diretoria'; end if;
  select * into a from public.athletes where id = p_athlete and tenant_id = tn for update;
  if not found then raise exception 'Atleta não encontrado'; end if;
  if exists (select 1 from public.payments where athlete_id = p_athlete) then
    raise exception 'Este atleta tem pagamentos registrados. Para preservar o histórico e o saldo do Caixa, desative o atleta em vez de excluir.';
  end if;

  delete from public.profiles where athlete_id = p_athlete and role = 'atleta';
  update public.profiles set athlete_id = null where athlete_id = p_athlete;
  delete from public.notifications where athlete_id = p_athlete;
  delete from public.charges where athlete_id = p_athlete;
  delete from public.athletes where id = p_athlete;

  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
  values (tn, auth.uid(), 'DELETE_ATHLETE', 'athletes', p_athlete::text, jsonb_build_object('full_name', a.full_name));
end $$;

create or replace function public.admin_update_charge(p_charge uuid, p_amount numeric, p_due date) returns void
language plpgsql security definer set search_path = public as $$
declare paid numeric; c record;
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  select * into c from public.charges where id = p_charge and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'Mensalidade não encontrada'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 9999999 then raise exception 'Informe um valor válido (0 ou mais)'; end if;
  if p_due is null then raise exception 'Informe o vencimento'; end if;
  select coalesce(sum(amount), 0) into paid from public.payments where charge_id = p_charge;
  update public.charges set amount = p_amount, due_date = p_due,
    status = case when paid >= p_amount and (paid > 0 or p_amount = 0) then 'pago'::public.charge_status
                  when paid > 0 then 'parcial'::public.charge_status
                  when c.status = 'em_conferencia' then c.status
                  else 'pendente'::public.charge_status end
    where id = p_charge;
end $$;

create or replace function public.admin_delete_charge(p_charge uuid, p_with_payments boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare c record; n int; paid numeric; tn uuid := public.current_tenant();
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  select * into c from public.charges where id = p_charge and tenant_id = tn for update;
  if not found then raise exception 'Mensalidade não encontrada'; end if;
  select count(*), coalesce(sum(amount), 0) into n, paid from public.payments where charge_id = p_charge;
  if n > 0 and not p_with_payments then
    raise exception 'A mensalidade tem % pagamento(s) (total %). Confirme a exclusão dos pagamentos para continuar.', n, paid;
  end if;
  delete from public.notifications where charge_id = p_charge;
  delete from public.payments where charge_id = p_charge;
  delete from public.charges where id = p_charge;
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
    values (tn, auth.uid(), 'DELETE_CHARGE', 'charges', p_charge::text,
            jsonb_build_object('athlete_id', c.athlete_id, 'competence', c.competence, 'amount', c.amount, 'payments_deleted', n, 'payments_total', paid));
end $$;

create or replace function public.set_match_players(p_match uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb; aid uuid; g int; seen uuid[] := '{}'; tn uuid := public.current_tenant();
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  if not exists (select 1 from public.matches where id = p_match and tenant_id = tn) then raise exception 'Jogo não encontrado'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'Lista inválida'; end if;
  delete from public.match_players where match_id = p_match;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    aid := (r->>'athlete_id')::uuid;
    g := coalesce((r->>'goals')::int, 0);
    if aid = any(seen) then raise exception 'Atleta repetido na lista do jogo'; end if;
    if g < 0 or g > 30 then raise exception 'Gols deve estar entre 0 e 30'; end if;
    seen := seen || aid;
    insert into public.match_players (tenant_id, match_id, athlete_id, goals) values (tn, p_match, aid, g);
  end loop;
end $$;

create or replace function public.set_match_lineup(p_match uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb; aid uuid; seen uuid[] := '{}'; n int := 0; tn uuid := public.current_tenant();
begin
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
  if not exists (select 1 from public.matches where id = p_match and tenant_id = tn) then raise exception 'Jogo não encontrado'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'Lista inválida'; end if;
  if exists (select 1 from public.matches where id = p_match and lineup_confirmed) then
    raise exception 'Escalação confirmada: reabra a edição para alterar';
  end if;
  delete from public.match_lineups where match_id = p_match;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    aid := (r->>'athlete_id')::uuid;
    if aid = any(seen) then raise exception 'Atleta repetido na escalação'; end if;
    seen := seen || aid;
    insert into public.match_lineups (tenant_id, match_id, athlete_id, team, is_keeper, shirt_number, sort_order)
    values (tn, p_match, aid, (r->>'team')::public.lineup_team, coalesce((r->>'is_keeper')::boolean, false),
            nullif(r->>'shirt_number', '')::smallint, n);
    n := n + 1;
  end loop;
end $$;

create or replace function public.month_birthdays()
returns table (display_name text, bday int, bmonth int, turning_age int, is_today boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ano int := extract(year from hoje);
  bissexto boolean := (ano % 4 = 0 and ano % 100 <> 0) or ano % 400 = 0;
begin
  if not public.is_member() then raise exception 'Acesso negado'; end if;
  return query
  select d.nome, d.dia, d.mes, ano - extract(year from d.nasc)::int,
         (d.mes = extract(month from hoje)::int and d.dia = extract(day from hoje)::int)
  from (
    select coalesce(nullif(trim(a.nickname), ''), a.full_name) as nome,
           case when extract(month from a.birth_date) = 2 and extract(day from a.birth_date) = 29 and not bissexto
                then 28 else extract(day from a.birth_date)::int end as dia,
           extract(month from a.birth_date)::int as mes,
           a.birth_date as nasc
    from public.athletes a
    where a.active and a.birth_date is not null and a.tenant_id = public.current_tenant()
  ) d
  where d.mes = extract(month from hoje)::int and d.nasc <= hoje
  order by d.dia, d.nome;
end $$;

create or replace function public.scorer_seasons() returns int[]
language plpgsql stable security definer set search_path = public as $$
declare cur int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int; res int[];
begin
  if not public.is_member() then raise exception 'Acesso negado'; end if;
  select coalesce(array_agg(y order by y desc), '{}') into res from (
    select distinct extract(year from m.match_date)::int as y
    from public.match_players mp
    join public.matches m on m.id = mp.match_id and m.status = 'finalizado' and m.tenant_id = public.current_tenant()
    union select cur) s;
  return res;
end $$;

create or replace function public.top_scorers(p_season int default null)
returns table (athlete_id uuid, display_name text, goals int, games int, pos int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare s int := coalesce(p_season, extract(year from (now() at time zone 'America/Sao_Paulo'))::int);
begin
  if not public.is_member() then raise exception 'Acesso negado'; end if;
  return query
  with t as (
    select a.id as aid, coalesce(nullif(trim(a.nickname), ''), a.full_name) as nome,
           sum(mp.goals)::int as g, count(*)::int as j
    from public.match_players mp
    join public.matches m on m.id = mp.match_id and m.status = 'finalizado' and extract(year from m.match_date)::int = s
                         and m.tenant_id = public.current_tenant()
    join public.athletes a on a.id = mp.athlete_id and a.tenant_id = public.current_tenant()
    group by a.id, a.nickname, a.full_name
  )
  select t.aid, t.nome, t.g, t.j, (rank() over (order by t.g desc))::int
  from t where t.g > 0
  order by 5, t.j, t.nome
  limit 5;
end $$;

create or replace function public.scorer_stats(p_athlete uuid, p_season int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  s int := coalesce(p_season, extract(year from (now() at time zone 'America/Sao_Paulo'))::int);
  tn uuid := public.current_tenant();
  nome text; g int; j int; mes int; pos int; hist jsonb;
begin
  if not public.is_member() then raise exception 'Acesso negado'; end if;
  select coalesce(nullif(trim(a.nickname), ''), a.full_name) into nome from public.athletes a where a.id = p_athlete and a.tenant_id = tn;
  if nome is null then raise exception 'Atleta não encontrado'; end if;
  select coalesce(sum(mp.goals), 0)::int, count(*)::int into g, j
    from public.match_players mp join public.matches m on m.id = mp.match_id and m.status = 'finalizado' and m.tenant_id = tn
    where mp.athlete_id = p_athlete and extract(year from m.match_date)::int = s;
  if s = extract(year from hoje)::int then
    select coalesce(sum(mp.goals), 0)::int into mes
      from public.match_players mp join public.matches m on m.id = mp.match_id and m.status = 'finalizado' and m.tenant_id = tn
      where mp.athlete_id = p_athlete and extract(year from m.match_date)::int = s and extract(month from m.match_date) = extract(month from hoje);
  end if;
  if g > 0 then
    select 1 + count(*)::int into pos from (
      select mp.athlete_id from public.match_players mp
      join public.matches m on m.id = mp.match_id and m.status = 'finalizado' and m.tenant_id = tn and extract(year from m.match_date)::int = s
      group by mp.athlete_id having sum(mp.goals) > g) x;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('date', m.match_date, 'team_a', m.team_a, 'team_b', m.team_b,
           'score_a', m.score_a, 'score_b', m.score_b, 'goals', mp.goals) order by m.match_date desc, m.match_time desc nulls last), '[]'::jsonb) into hist
    from public.match_players mp join public.matches m on m.id = mp.match_id and m.status = 'finalizado' and m.tenant_id = tn
    where mp.athlete_id = p_athlete and extract(year from m.match_date)::int = s;
  return jsonb_build_object('name', nome, 'season', s, 'goals', g, 'games', j,
    'avg', case when j > 0 then round(g::numeric / j, 2) else 0 end,
    'month_goals', mes, 'position', pos, 'history', hist);
end $$;

-- Baixa de Pix (servidor): a organização vem da própria cobrança, nunca de quem chama.
create or replace function public.register_pix_payment(p_correlation text, p_value_cents int, p_e2e text, p_paid_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare pc record; dia date;
begin
  if coalesce(p_e2e, '') = '' then return jsonb_build_object('result', 'invalid'); end if;
  select * into pc from public.pix_charges where correlation_id = p_correlation for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if exists (select 1 from public.payments where bank_txid = p_e2e and tenant_id = pc.tenant_id) then
    return jsonb_build_object('result', 'duplicate', 'charge_id', pc.charge_id, 'athlete_id', pc.athlete_id);
  end if;
  if p_value_cents is distinct from pc.value_cents then
    update public.pix_charges set status = 'divergente', review = true, e2e_id = p_e2e, paid_at = p_paid_at,
      note = format('Valor recebido (%s centavos) difere do cobrado (%s). Confira e registre manualmente.', p_value_cents, pc.value_cents)
      where id = pc.id;
    return jsonb_build_object('result', 'divergent', 'charge_id', pc.charge_id, 'athlete_id', pc.athlete_id);
  end if;
  dia := (p_paid_at at time zone 'America/Sao_Paulo')::date;
  begin
    insert into public.payments (tenant_id, athlete_id, charge_id, amount, paid_at, method, source, bank_txid, notes)
    values (pc.tenant_id, pc.athlete_id, pc.charge_id, p_value_cents / 100.0, dia, 'pix', 'pix_webhook', p_e2e, 'Pix recebido via OpenPix');
  exception
    when unique_violation then
      return jsonb_build_object('result', 'duplicate', 'charge_id', pc.charge_id, 'athlete_id', pc.athlete_id);
    when raise_exception then
      update public.pix_charges set
        status = case when status = 'paga' then status else 'conferir' end,
        e2e_id = case when status = 'paga' then e2e_id else p_e2e end,
        paid_at = case when status = 'paga' then paid_at else p_paid_at end,
        review = true,
        note = left('Pagamento adicional recebido (' || p_e2e || '): ' || sqlerrm, 300)
        where id = pc.id;
      return jsonb_build_object('result', 'conflict', 'charge_id', pc.charge_id, 'athlete_id', pc.athlete_id);
  end;
  update public.pix_charges set status = 'paga', e2e_id = p_e2e, paid_at = p_paid_at where id = pc.id;
  return jsonb_build_object('result', 'ok', 'charge_id', pc.charge_id, 'athlete_id', pc.athlete_id);
end $$;

-- Funções auxiliares de organização: só usuários logados e o servidor.
revoke execute on function public.current_tenant(), public.default_tenant(), public.resolve_tenant() from public, anon;
grant execute on function public.current_tenant(), public.default_tenant(), public.resolve_tenant() to authenticated, service_role;
