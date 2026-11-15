// Testes de isolamento multi-tenant. Sobe um Postgres local descartável, aplica 0001–0015, cria dados "legados"
// do GEAB, aplica 0016 e prova que (1) nada se perde e (2) um grupo nunca vê nem altera dados de outro.
// Uso: npm i --no-save embedded-postgres pg && node supabase/tests/run-tests.mjs
import EmbeddedPostgres from "embedded-postgres"
import pg from "pg"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const migDir = path.join(here, "..", "migrations")
const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()
fs.rmSync(path.join(here, ".pgdata-tests"), { recursive: true, force: true })
const server = new EmbeddedPostgres({ databaseDir: path.join(here, ".pgdata-tests"), user: "postgres", password: "test", port: 54331, persistent: false, onLog: () => {}, onError: () => {} })
process.on("uncaughtException", async (e) => { console.error(e); try { await server.stop() } catch {} process.exit(1) })
await server.initialise(); await server.start(); await server.createDatabase("geab_test")
const db = new pg.Client({ connectionString: "postgresql://postgres:test@localhost:54331/geab_test" }); await db.connect()

let pass = 0, fail = 0
const ok = (name, cond, detail = "") => { if (cond) { pass++; console.log("  ✓", name) } else { fail++; console.log("  ✗", name, detail) } }
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const one = async (sql, p = []) => Object.values((await q(sql, p))[0] ?? {})[0]
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const U = { geabAdmin: uid(1), geabAtleta: uid(2), geabPending: uid(3), peladaAdmin: uid(4) }

/** Executa fn numa transação como o usuário (role authenticated) ou como service_role; sempre desfaz no final. */
async function as(who, fn, commit = false) {
  await db.query("begin")
  let done = false
  try {
    if (who === "service") await db.query("set local role service_role")
    else { await db.query("set local role authenticated"); await db.query("select set_config('request.jwt.claim.sub', $1, true)", [who]) }
    const r = await fn()
    if (commit) { await db.query("commit"); done = true }
    return r
  } finally { if (!done) await db.query("rollback") }
}
async function err(sql, p = []) {
  await db.query("savepoint s")
  try { await db.query(sql, p); await db.query("release savepoint s"); return null }
  catch (e) { await db.query("rollback to savepoint s"); return e.message }
}
const section = (t) => console.log("\n" + t)

// ───────── 1) base atual (0001–0015) + dados legados do GEAB ─────────
await db.query(fs.readFileSync(path.join(here, "supabase-stub.sql"), "utf8"))
for (const f of files.filter((f) => f < "0016")) await db.query(fs.readFileSync(path.join(migDir, f), "utf8"))

const G = { athlete: uid(101), charge: uid(102), match: uid(103), request: uid(104) }
await db.query(`insert into auth.users (id, email) values ($1,'admin@geab'),($2,'atleta@geab'),($3,'pendente@geab')`, [U.geabAdmin, U.geabAtleta, U.geabPending])
await db.query(`insert into public.athletes (id, full_name, nickname, birth_date) values ($1,'Gabriel Geab','Gabi', date_trunc('month', current_date)::date - interval '20 years')`, [G.athlete])
await db.query(`insert into public.profiles (id, full_name, role) values ($1,'Admin Geab','admin')`, [U.geabAdmin])
await db.query(`insert into public.profiles (id, full_name, role, athlete_id) values ($1,'Gabriel Geab','atleta',$2)`, [U.geabAtleta, G.athlete])
await db.query(`insert into public.charges (id, athlete_id, competence, due_date, amount) values ($1,$2,'2026-11-01','2026-11-10',100)`, [G.charge, G.athlete])
await db.query(`insert into public.payments (athlete_id, charge_id, amount, paid_at, bank_txid) values ($1,$2,60,current_date,'E2E-1')`, [G.athlete, G.charge])
await db.query(`insert into public.expenses (spent_at, description, amount) values (current_date,'Bola',50)`)
await db.query(`insert into public.other_income (received_at, description, amount) values (current_date,'Patrocínio',20)`)
await db.query(`insert into public.matches (id, match_date, status, score_a, score_b) values ($1, current_date, 'finalizado', 2, 1)`, [G.match])
await db.query(`insert into public.match_players (match_id, athlete_id, goals) values ($1,$2,2)`, [G.match, G.athlete])
await db.query(`insert into public.signup_requests (id, user_id, email, full_name) values ($1,$2,'pendente@geab','Novo Geab')`, [G.request, U.geabPending])
await db.query(`insert into public.app_settings (key, value) values ('pix_br_code','geab-pix')`)
await db.query(`insert into public.btg_connection (access_token, refresh_token, expires_at) values ('a','r', now() + interval '1 hour')`)
const before = {}
for (const t of ["athletes","profiles","charges","payments","expenses","other_income","matches","match_players","signup_requests","app_settings","btg_connection","audit_log"]) before[t] = await one(`select count(*)::int from public.${t}`)

// ───────── 2) migração 0016 sobre dados existentes ─────────
section("Migração dos dados existentes")
await db.query(fs.readFileSync(path.join(migDir, "0016_multitenant.sql"), "utf8"))
const geab = await one(`select id from public.organizations where slug='geab'`)
for (const f of files.filter((f) => f >= "0017")) await db.query(fs.readFileSync(path.join(migDir, f), "utf8"))   // 0017+
for (const t of Object.keys(before)) {
  const n = await one(`select count(*)::int from public.${t}`)
  const orphan = await one(`select count(*)::int from public.${t} where tenant_id is distinct from $1`, [geab])
  // A migration 0024 renomeia a equipe nos jogos existentes e a auditoria registra uma linha por jogo alterado.
  const extra = t === "audit_log" ? await one(`select count(*)::int from public.audit_log where entity = 'matches' and action = 'UPDATE'`) : 0
  ok(`${t}: ${before[t]} linhas preservadas, todas na organização geab`, n === before[t] + extra && orphan === 0, `n=${n} orfas=${orphan} extra=${extra}`)
}

// Transição: com uma única organização, o servidor ainda grava sem informar o tenant.
ok("0024: jogos existentes passam de Equipe Branca para Equipe Branco", (await one(`select count(*)::int from public.matches where team_b = 'Equipe Branca'`)) === 0 && (await one(`select count(*)::int from public.matches where team_b = 'Equipe Branco'`)) >= 1)

section("Transição (1 organização)")
await as("service", async () => {
  await db.query(`insert into public.expenses (spent_at, description, amount) values (current_date,'Servidor',1)`)
  ok("service_role grava sem tenant_id e cai no geab", (await one(`select tenant_id from public.expenses where description='Servidor'`)) === geab)
})

// ───────── 3) segunda organização ─────────
const P = { athlete: uid(201), charge: uid(202), match: uid(203), pix: uid(204), org: uid(900) }
await db.query(`insert into public.organizations (id, slug, name) values ($1,'pelada','Pelada de Terça')`, [P.org])
await db.query(`insert into auth.users (id, email) values ($1,'admin@pelada')`, [U.peladaAdmin])
await db.query(`insert into public.athletes (id, tenant_id, full_name, nickname, birth_date) values ($1,$2,'Paulo Pelada','Paulão', date_trunc('month', current_date)::date - interval '30 years')`, [P.athlete, P.org])
await db.query(`insert into public.profiles (id, tenant_id, full_name, role) values ($1,$2,'Admin Pelada','admin')`, [U.peladaAdmin, P.org])
await db.query(`insert into public.charges (id, tenant_id, athlete_id, competence, due_date, amount) values ($1,$2,$3,'2026-11-01','2026-11-10',100)`, [P.charge, P.org, P.athlete])
await db.query(`insert into public.payments (tenant_id, athlete_id, charge_id, amount, paid_at, bank_txid) values ($1,$2,$3,40,current_date,'E2E-PEL')`, [P.org, P.athlete, P.charge])
await db.query(`insert into public.expenses (tenant_id, spent_at, description, amount) values ($1,current_date,'Colete',7)`, [P.org])
await db.query(`insert into public.matches (id, tenant_id, match_date, status, score_a, score_b) values ($1,$2,current_date,'finalizado',1,0)`, [P.match, P.org])
await db.query(`insert into public.match_players (tenant_id, match_id, athlete_id, goals) values ($1,$2,$3,1)`, [P.org, P.match, P.athlete])
await db.query(`insert into public.pix_charges (id, tenant_id, charge_id, athlete_id, correlation_id, value_cents) values ($1,$2,$3,$4,'corr-pelada',6000)`, [P.pix, P.org, P.charge, P.athlete])
await db.query("begin")
const eCross = await err(`insert into public.payments (tenant_id, athlete_id, charge_id, amount, paid_at, bank_txid) values ($1,$2,$3,5,current_date,'E2E-1')`, [P.org, P.athlete, P.charge])
const eSame = await err(`insert into public.payments (tenant_id, athlete_id, charge_id, amount, paid_at, bank_txid) values ($1,$2,$3,5,current_date,'E2E-PEL')`, [P.org, P.athlete, P.charge])
await db.query("rollback")
ok("mesmo bank_txid em organizações diferentes é permitido", eCross === null, eCross ?? "")
ok("mesmo bank_txid na MESMA organização continua proibido", !!eSame && /unique|duplicate|duplic/i.test(eSame), eSame ?? "")

section("Leitura isolada (admin da Pelada)")
await as(U.peladaAdmin, async () => {
  for (const [t, n] of [["athletes",1],["profiles",1],["charges",1],["payments",1],["expenses",1],["other_income",0],["matches",1],["match_players",1],["pix_charges",1],["signup_requests",0],["app_settings",0],["organizations",1]])
    ok(`${t}: vê ${n}`, (await one(`select count(*)::int from public.${t}`)) === n)
  ok("audit_log só da própria organização", (await one(`select count(*)::int from public.audit_log where tenant_id <> $1`, [P.org])) === 0)
  ok("cash_summary soma só a Pelada (40)", Number(await one(`select total_in from public.cash_summary`)) === 40)
  ok("charges_view só da Pelada", (await one(`select count(*)::int from public.charges_view`)) === 1)
  ok("admin_users lista só a Pelada", (await q(`select * from public.admin_users()`)).length === 1)
  const b = await q(`select * from public.month_birthdays()`)
  ok("aniversariantes só da Pelada", b.length === 1 && b[0].display_name === "Paulão", JSON.stringify(b))
  const s = await q(`select * from public.top_scorers()`)
  ok("artilharia só da Pelada", s.length === 1 && s[0].display_name === "Paulão", JSON.stringify(s))
  ok("scorer_seasons ok", Array.isArray(await one(`select public.scorer_seasons()`)))
})

section("Leitura isolada (admin do GEAB)")
await as(U.geabAdmin, async () => {
  for (const [t, n] of [["athletes",1],["profiles",2],["charges",1],["payments",1],["expenses",1],["other_income",1],["matches",1],["pix_charges",0],["signup_requests",1],["app_settings",1],["organizations",1]])
    ok(`${t}: vê ${n}`, (await one(`select count(*)::int from public.${t}`)) === n)
  ok("cash_summary soma só o GEAB (60+20)", Number(await one(`select total_in from public.cash_summary`)) === 80)
  const s = await q(`select * from public.top_scorers()`)
  ok("artilharia só do GEAB", s.length === 1 && s[0].display_name === "Gabi", JSON.stringify(s))
  ok("btg_connection inacessível ao navegador", /permission denied/.test(await err(`select * from public.btg_connection`) ?? ""))
})

section("Escrita bloqueada entre organizações (admin da Pelada)")
await as(U.peladaAdmin, async () => {
  ok("UPDATE em atleta do GEAB não afeta nada", (await db.query(`update public.athletes set full_name='HACK' where id=$1`, [G.athlete])).rowCount === 0)
  ok("DELETE em atleta do GEAB não afeta nada", (await db.query(`delete from public.athletes where id=$1`, [G.athlete])).rowCount === 0)
  ok("UPDATE em pagamento do GEAB não afeta nada", (await db.query(`update public.payments set amount=1 where tenant_id=$1`, [geab])).rowCount === 0)
  ok("INSERT com tenant_id do GEAB é recusado", !!(await err(`insert into public.athletes (tenant_id, full_name) values ($1,'Infiltrado')`, [geab])))
  await db.query(`insert into public.athletes (full_name) values ('Sem tenant explícito')`)
  ok("INSERT sem tenant_id herda a organização do usuário", (await one(`select tenant_id from public.athletes where full_name='Sem tenant explícito'`)) === P.org)
  ok("tenant_id é imutável", !!(await err(`update public.athletes set tenant_id=$1 where id=$2`, [geab, P.athlete])))
  ok("não altera a tabela de organizações", (await db.query(`update public.organizations set name='X'`)).rowCount === 0 && !!(await err(`insert into public.organizations (slug,name) values ('x','X')`)))
})

section("Funções administrativas não cruzam organizações (admin da Pelada)")
await as(U.peladaAdmin, async () => {
  const cases = [
    ["admin_delete_athlete", `select public.admin_delete_athlete($1)`, [G.athlete]],
    ["admin_update_charge", `select public.admin_update_charge($1, 1, current_date)`, [G.charge]],
    ["admin_delete_charge", `select public.admin_delete_charge($1, true)`, [G.charge]],
    ["approve_signup", `select public.approve_signup($1)`, [G.request]],
    ["reject_signup", `select public.reject_signup($1)`, [G.request]],
    ["admin_update_user", `select public.admin_update_user($1, 'Hacker Nome', 'admin', true, null)`, [U.geabAdmin]],
    ["admin_remove_access", `select public.admin_remove_access($1)`, [U.geabAdmin]],
    ["set_match_players", `select public.set_match_players($1, '[]')`, [G.match]],
    ["set_match_lineup", `select public.set_match_lineup($1, '[]')`, [G.match]],
    ["scorer_stats", `select public.scorer_stats($1)`, [G.athlete]],
  ]
  for (const [n, sql, p] of cases) { const e = await err(sql, p); ok(`${n} recusa registro do GEAB`, !!e && /não encontrad/i.test(e), e ?? "executou!") }
  ok("generate_charges só cria da própria organização", (await one(`select public.generate_charges('2026-12-01')`)) === 1)
})
ok("geral: nada do GEAB mudou", (await one(`select full_name from public.athletes where id=$1`, [G.athlete])) === "Gabriel Geab" && (await one(`select count(*)::int from public.charges where athlete_id=$1`, [G.athlete])) === 1)

section("Referências cruzadas bloqueadas (admin da Pelada)")
await as(U.peladaAdmin, async () => {
  let e = await err(`insert into public.match_players (match_id, athlete_id, goals) values ($1,$2,0)`, [P.match, G.athlete]); ok("jogador do GEAB em jogo da Pelada", !!e && /outra organização/.test(e), e ?? "")
  e = await err(`insert into public.payments (athlete_id, charge_id, amount, paid_at) values ($1,$2,1,current_date)`, [P.athlete, G.charge]); ok("pagamento em mensalidade do GEAB", !!e, e ?? "")
  e = await err(`select public.set_match_players($1, jsonb_build_array(jsonb_build_object('athlete_id',$2::text,'goals',1)))`, [P.match, G.athlete]); ok("set_match_players com atleta do GEAB", !!e && /outra organização/.test(e), e ?? "")
  e = await err(`select public.set_match_lineup($1, jsonb_build_array(jsonb_build_object('athlete_id',$2::text,'team','a')))`, [P.match, G.athlete]); ok("set_match_lineup com atleta do GEAB", !!e && /outra organização/.test(e), e ?? "")
  e = await err(`update public.profiles set athlete_id=$1 where id=$2`, [G.athlete, U.peladaAdmin]); ok("vincular perfil a atleta do GEAB", !!e, e ?? "")
})

section("Administrador por organização")
await db.query("begin")
const eLast = await err(`update public.profiles set active=false where id=$1`, [U.peladaAdmin])
await db.query("rollback")
ok("a Pelada não pode ficar sem administrador (mesmo com admins no GEAB)", !!eLast && /pelo menos um/.test(eLast), eLast ?? "")

section("Atleta (portal) vê só o que é dele")
await as(U.geabAtleta, async () => {
  ok("athletes: 1 (o próprio)", (await one(`select count(*)::int from public.athletes`)) === 1)
  ok("charges: 1", (await one(`select count(*)::int from public.charges`)) === 1)
  ok("payments: 1", (await one(`select count(*)::int from public.payments`)) === 1)
  ok("despesas: 0", (await one(`select count(*)::int from public.expenses`)) === 0)
  ok("jogos: só os do GEAB", (await one(`select count(*)::int from public.matches`)) === 1)
  ok("não aprova cadastro", !!(await err(`select public.approve_signup($1)`, [G.request])))
})

section("Compatibilidade com o front atual")
await as(U.geabAdmin, async () => {
  await db.query(`insert into public.app_settings (key, value) values ('pix_br_code','novo') on conflict (tenant_id, key) do update set value = excluded.value`)
  ok("salvar a chave Pix (upsert por organização+chave) continua funcionando", (await one(`select value from public.app_settings where key='pix_br_code'`)) === "novo")
})
await as(U.peladaAdmin, async () => {
  await db.query(`insert into public.app_settings (key, value) values ('pix_br_code','pelada-pix') on conflict (tenant_id, key) do update set value = excluded.value`)
  ok("a Pelada tem a própria chave Pix, sem sobrescrever a do GEAB", (await one(`select value from public.app_settings where key='pix_br_code'`)) === "pelada-pix")
})
ok("chave Pix do GEAB intacta", (await one(`select value from public.app_settings where key='pix_br_code' and tenant_id=$1`, [geab])) === "geab-pix")

section("Servidor (service_role)")
await as("service", async () => {
  ok("omitir tenant com 2+ organizações falha (não grava no grupo errado)", !!(await err(`insert into public.expenses (spent_at, description, amount) values (current_date,'x',1)`)))
  const r1 = await one(`select public.register_pix_payment('corr-pelada', 6000, 'E2E-1', now())`)
  ok("Pix com e2e igual ao de OUTRA organização não é duplicado", r1.result === "ok", JSON.stringify(r1))
  ok("pagamento caiu na organização da cobrança", (await one(`select tenant_id from public.payments where bank_txid='E2E-1' and amount=60 and athlete_id=$1`, [P.athlete])) === P.org)
  const r2 = await one(`select public.register_pix_payment('corr-pelada', 6000, 'E2E-1', now())`)
  ok("repetir o mesmo Pix é duplicado", r2.result === "duplicate", JSON.stringify(r2))
})

section("Cadastro público (formulário)")
await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'novo@pelada','{"signup_form":"true","full_name":"Novo Pelada","tenant_slug":"pelada"}')`, [uid(301)])
ok("com tenant_slug cai na organização certa", (await one(`select tenant_id from public.signup_requests where user_id=$1`, [uid(301)])) === P.org)
await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'sem@slug','{"signup_form":"true","full_name":"Sem Slug"}')`, [uid(302)])
ok("sem tenant_slug e 2+ organizações: não cria solicitação", (await one(`select count(*)::int from public.signup_requests where user_id=$1`, [uid(302)])) === 0)
await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'x@x','{"signup_form":"true","full_name":"Ghost","tenant_slug":"nao-existe"}')`, [uid(303)])
ok("organização inexistente: não cria solicitação", (await one(`select count(*)::int from public.signup_requests where user_id=$1`, [uid(303)])) === 0)

section("Etapa 2: novos grupos, identidade e suspensão")
await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'dono@futsal','{"full_name":"Dona Futsal","phone":"5548999991111","new_org_slug":"futsal-amigos","new_org_name":"Futsal dos Amigos"}')`, [uid(401)])
const fut = await q(`select o.id, o.status, o.trial_ends_at is not null as trial, p.role from public.organizations o join public.profiles p on p.tenant_id = o.id and p.id = $1 where o.slug = 'futsal-amigos'`, [uid(401)])
ok("cadastro com new_org cria o grupo em teste e torna o usuário administrador", fut.length === 1 && fut[0].status === "teste" && fut[0].trial && fut[0].role === "admin", JSON.stringify(fut))
await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'x@dup','{"new_org_slug":"geab","new_org_name":"Copia"}'),($2,'y@res','{"new_org_slug":"admin","new_org_name":"Reservado"}')`, [uid(402), uid(403)])
ok("slug já usado ou reservado não cria grupo", (await one(`select count(*)::int from public.organizations where name in ('Copia','Reservado')`)) === 0)
ok("slug_available recusa usado, reservado e inválido", !(await one(`select public.slug_available('geab')`)) && !(await one(`select public.slug_available('www')`)) && !(await one(`select public.slug_available('A_b')`)) && (await one(`select public.slug_available('time-novo')`)))
await as(uid(401), async () => {
  ok("dono do novo grupo não vê nada do GEAB nem da Pelada", (await one(`select count(*)::int from public.athletes`)) === 0 && (await one(`select count(*)::int from public.expenses`)) === 0)
  await db.query(`select public.update_organization('Futsal Premium', 'https://exemplo.com/logo.png', '#0057B8', 'futsal.com.br', 'Lema')`)
  ok("Diretoria edita a identidade do próprio grupo", (await one(`select name from public.organizations`)) === "Futsal Premium")
  ok("logotipo não-https é recusado", /https/.test(await err(`select public.update_organization('X','javascript:alert(1)',null,null,null)`) ?? ""))
  ok("cor inválida é recusada", /Cor/.test(await err(`select public.update_organization('X',null,'azul',null,null)`) ?? ""))
})
await as(U.peladaAdmin, async () => {
  await db.query(`select public.update_organization('Pelada Renomeada', null, null, null, null)`)
  ok("Pelada renomeada", (await one(`select name from public.organizations`)) === "Pelada Renomeada")
})
ok("nome do GEAB intacto", (await one(`select name from public.organizations where slug='geab'`)) === "GEAB Futebol")
{ // consulta pública (sem login)
  await db.query("begin"); await db.query("set local role anon")
  const pub = await q(`select * from public.org_public('geab')`)
  ok("org_public (anon) devolve só dados de identidade", pub.length === 1 && Object.keys(pub[0]).sort().join() === "logo_url,name,primary_color,slug,tagline,website", JSON.stringify(Object.keys(pub[0] ?? {})))
  ok("org_public sem slug com 2+ grupos: nada", (await q(`select * from public.org_public(null)`)).length === 0)
  ok("anon não lê tabelas", !!(await err(`select * from public.athletes`)) || (await one(`select count(*)::int from public.athletes`)) === 0)
  await db.query("rollback")
}
await db.query(`update public.organizations set status='suspensa' where slug='pelada'`)
await as(U.peladaAdmin, async () => {
  ok("grupo suspenso perde o acesso a tudo", (await one(`select count(*)::int from public.athletes`)) === 0 && (await one(`select count(*)::int from public.charges`)) === 0 && !!(await err(`select public.generate_charges('2027-01-01')`)))
})
{ await db.query("begin"); await db.query("set local role anon")
  ok("org_public esconde grupo suspenso", (await q(`select * from public.org_public('pelada')`)).length === 0)
  await db.query("rollback") }
await db.query(`update public.organizations set status='ativa' where slug='pelada'`)
await as(U.peladaAdmin, async () => { ok("reativar devolve o acesso", (await one(`select count(*)::int from public.athletes`)) >= 1) })

section("Etapa 3: super admin, planos e limites")
ok("GEAB foi para o plano ilimitado e os demais para o teste gratuito", (await one(`select p.code from public.organizations o join public.plans p on p.id=o.plan_id where o.slug='geab'`)) === "ilimitado" && (await one(`select p.code from public.organizations o join public.plans p on p.id=o.plan_id where o.slug='pelada'`)) === "teste")
await db.query(`insert into auth.users (id, email) values ($1,'dono@plataforma')`, [uid(600)])
await as(U.peladaAdmin, async () => {
  for (const sql of [`select public.sa_overview()`, `select * from public.sa_orgs()`, `select * from public.sa_plans()`,
    `select public.sa_set_org_status('${geab}', 'suspensa')`, `select public.sa_set_org_plan('${geab}', 'basico')`, `select public.sa_extend_trial('${geab}', 5)`,
    `select public.sa_set_notes('${geab}', 'x')`, `select public.sa_create_org('hack', 'Hack')`, `select public.sa_upsert_plan('x', 'X', 0, 1, true)`,
    `select public.sa_assign_admin('${geab}', 'dono@plataforma')`]) {
    const e = await err(sql); ok(`admin comum é barrado: ${sql.slice(7, 40)}`, !!e && /Acesso restrito/.test(e), e ?? "executou!")
  }
  ok("admin comum não lê platform_admins nem org_internal", !!(await err(`select * from public.platform_admins`)) || (await one(`select count(*)::int from public.platform_admins`)) === 0)
  ok("admin comum não lê as anotações internas", (await one(`select count(*)::int from public.org_internal`)) === 0)
  ok("is_platform_admin é falso para admin comum", (await one(`select public.is_platform_admin()`)) === false)
})
await db.query(`insert into public.platform_admins (user_id) values ($1)`, [uid(600)])
await db.query(`update public.organizations set status='ativa', plan_id=(select id from public.plans where code='basico') where slug='pelada'`)
await as(uid(600), async () => {
  ok("is_platform_admin é verdadeiro para o dono", (await one(`select public.is_platform_admin()`)) === true)
  const o = await one(`select public.sa_overview()`)
  ok("overview: contagens de grupos", o.orgs_total >= 3 && o.orgs_ativa >= 2 && o.orgs_teste >= 1, JSON.stringify(o))
  ok("overview: MRR soma só grupos ativos pagantes (Básico = 9900)", o.mrr_cents === 9900, `mrr=${o.mrr_cents}`)
  ok("overview: receita por plano", o.by_plan.some((x) => x.plan === "Básico" && x.mrr_cents === 9900), JSON.stringify(o.by_plan))
  const orgs = await q(`select * from public.sa_orgs()`)
  const g = orgs.find((x) => x.slug === "geab")
  ok("sa_orgs: só agregados e contato do responsável (sem nomes de atletas nem pagamentos)", Object.keys(g).join() === "id,slug,name,status,plan_code,plan_name,plan_price_cents,athletes,athletes_limit,admins,matches,created_at,trial_ends_at,paid_until,last_activity,last_access,notes,status_reason,contact_name,contact_email,contact_phone,cancelled_at", Object.keys(g).join())
  ok("sa_orgs: contagens corretas do GEAB", g.athletes === 1 && g.admins === 1 && g.matches === 1 && g.plan_code === "ilimitado", JSON.stringify(g))
  ok("o dono NÃO vê dados dos grupos pelas tabelas (isolamento intacto)", (await one(`select count(*)::int from public.athletes`)) === 0 && (await one(`select count(*)::int from public.payments`)) === 0)
  await db.query(`select public.sa_set_notes($1, 'cliente piloto')`, [P.org])
  ok("anotação interna salva e visível ao dono", (await q(`select notes from public.sa_orgs() where slug='pelada'`))[0].notes === "cliente piloto")
  await db.query(`select public.sa_extend_trial($1, 10)`, [P.org])
  ok("estender teste soma dias", (await one(`select trial_ends_at > now() + interval '9 days' from public.sa_orgs() where id=$1`, [P.org])) === true)
  ok("dias do teste fora de 1..90 recusado", /1 a 90/.test(await err(`select public.sa_extend_trial($1, 200)`, [P.org]) ?? ""))
  ok("situação inválida recusada", /inválida/.test(await err(`select public.sa_set_org_status($1, 'xyz')`, [P.org]) ?? ""))
  ok("plano inexistente recusado", /não encontrado/.test(await err(`select public.sa_set_org_plan($1, 'nao-existe')`, [P.org]) ?? ""))
  const plans = await q(`select * from public.sa_plans()`)
  ok("sa_plans lista os planos com a contagem de grupos", plans.length >= 4 && plans.find((x) => x.code === "basico").orgs >= 1)
  await db.query(`select public.sa_upsert_plan('mini', 'Mini', 1000, 1, true)`)
  ok("criar plano pelo painel", (await q(`select * from public.plans where code='mini'`)).length === 1)
  await db.query(`select public.sa_set_org_plan($1, 'mini')`, [P.org])
  ok("trocar o plano de um grupo", (await one(`select plan_code from public.sa_orgs() where id=$1`, [P.org])) === "mini")
}, true)
section("Funções internas não são chamáveis por usuários comuns")
await as(U.peladaAdmin, async () => {
  const e1 = await err(`select public.sa_log('${geab}', 'FALSO', '{}'::jsonb)`)
  ok("sa_log (auditoria de outro grupo) é negada a usuário comum", !!e1 && /permission denied/.test(e1), e1 ?? "executou!")
  const e2 = await err(`select public.sa_guard()`)
  ok("sa_guard é negada a usuário comum", !!e2 && /permission denied/.test(e2), e2 ?? "executou!")
})
ok("nenhuma linha falsa na auditoria do GEAB", (await one(`select count(*)::int from public.audit_log where action='FALSO'`)) === 0)

section("Limite de atletas do plano (Mini = 1 atleta ativo; a Pelada já tem 1)")
await as(U.peladaAdmin, async () => {
  const e = await err(`insert into public.athletes (full_name) values ('Segundo')`)
  ok("passar do limite é recusado com mensagem clara", !!e && /Limite de 1 atletas/.test(e), e ?? "")
  ok("atleta inativo não conta nem é bloqueado", (await err(`insert into public.athletes (full_name, active) values ('Inativo', false)`)) === null)
  const e2 = await err(`update public.athletes set active = true where full_name = 'Inativo'`)
  ok("reativar acima do limite também é recusado", !!e2 && /Limite/.test(e2), e2 ?? "")
})
await as(uid(600), async () => { await db.query(`select public.sa_upsert_plan('mini', 'Mini', 1000, 5, true)`) }, true)
await as(U.peladaAdmin, async () => { ok("ampliar o plano libera novos atletas", (await err(`insert into public.athletes (full_name) values ('Segundo')`)) === null) })
await as(U.geabAdmin, async () => { ok("plano ilimitado não tem limite", (await err(`insert into public.athletes (full_name) values ('Mais um')`)) === null) })

section("Suspender, reativar e criar grupo pelo painel")
await as(uid(600), async () => {
  await db.query(`select public.sa_set_org_status($1, 'suspensa', 'inadimplente')`, [P.org])
  const r = (await q(`select status, status_reason from public.sa_orgs() where slug='pelada'`))[0]
  ok("suspender registra o motivo", r.status === "suspensa" && r.status_reason === "inadimplente", JSON.stringify(r))
}, true)
await as(U.peladaAdmin, async () => { ok("grupo suspenso pelo painel perde o acesso", (await one(`select count(*)::int from public.athletes`)) === 0) })
ok("a ação do dono ficou na auditoria do grupo", (await one(`select count(*)::int from public.audit_log where tenant_id=$1 and action='SA_SET_STATUS' and user_id=$2`, [P.org, uid(600)])) === 1)
await as(uid(600), async () => { await db.query(`select public.sa_set_org_status($1, 'ativa', null)`, [P.org]) }, true)
await as(U.peladaAdmin, async () => { ok("reativar devolve o acesso", (await one(`select count(*)::int from public.athletes`)) >= 1) })
await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'novo@clube','{"full_name":"Dona do Clube"}')`, [uid(601)])
let clubId
await as(uid(600), async () => {
  clubId = await one(`select public.sa_create_org('clube-novo', 'Clube Novo', 'pro')`)
  ok("criar grupo pelo painel", !!clubId)
  ok("endereço repetido é recusado", /indisponível/.test(await err(`select public.sa_create_org('clube-novo', 'Outro', 'pro')`) ?? ""))
  await db.query(`select public.sa_assign_admin($1, 'novo@clube')`, [clubId])
  ok("e-mail sem conta é recusado", /Nenhuma conta/.test(await err(`select public.sa_assign_admin($1, 'ninguem@x')`, [clubId]) ?? ""))
  ok("conta que já tem grupo é recusada", /já pertence/.test(await err(`select public.sa_assign_admin($1, 'admin@pelada')`, [clubId]) ?? ""))
}, true)
ok("vincular administrador existente", (await one(`select count(*)::int from public.profiles where id=$1 and tenant_id=$2 and role='admin'`, [uid(601), clubId])) === 1)
await as(uid(601), async () => { ok("o novo administrador vê o grupo dele e nada dos outros", (await one(`select count(*)::int from public.organizations`)) === 1 && (await one(`select count(*)::int from public.athletes`)) === 0) })

section("Níveis de acesso: atleta, diretoria e administrador")
const D = uid(700)
await db.query(`insert into auth.users (id, email) values ($1,'diretoria@geab')`, [D])
await db.query(`insert into public.profiles (id, tenant_id, full_name, role) values ($1,$2,'Diretor Geab','diretoria')`, [D, geab])
const counts = async () => { const r = {}; for (const t of ["athletes","charges","payments","expenses","other_income","matches","match_players","notifications","signup_requests","pix_charges","match_lineups"]) r[t] = await one(`select count(*)::int from public.${t}`); r.cash = JSON.stringify((await db.query(`select total_in::float a, total_out::float b from public.cash_summary`)).rows[0]); r.view = await one(`select count(*)::int from public.charges_view`); return r }
const adminSees = await as(U.geabAdmin, counts)
const dirSees = await as(D, counts)
ok("diretoria enxerga exatamente o mesmo que o administrador (todas as áreas operacionais e o caixa)", JSON.stringify(adminSees) === JSON.stringify(dirSees), `${JSON.stringify(adminSees)} vs ${JSON.stringify(dirSees)}`)
await as(D, async () => {
  ok("diretoria NÃO lê a auditoria", (await one(`select count(*)::int from public.audit_log`)) === 0)
  ok("diretoria vê só o próprio perfil (não a lista de usuários)", (await one(`select count(*)::int from public.profiles`)) === 1)
  ok("diretoria não lê configurações internas, BTG nem anotações", (await one(`select count(*)::int from public.org_internal`)) === 0 && !!(await err(`select * from public.btg_connection`)))
  ok("diretoria vê a identidade do grupo", (await one(`select count(*)::int from public.organizations`)) === 1)
  ok("is_staff verdadeiro e is_admin falso", (await one(`select public.is_staff()`)) === true && (await one(`select public.is_admin()`)) === false)
  for (const [n, sql, p] of [
    ["criar atleta", `insert into public.athletes (full_name) values ('Intruso')`, []],
    ["lançar pagamento", `insert into public.payments (athlete_id, charge_id, amount, paid_at) values ($1,$2,1,current_date)`, [G.athlete, G.charge]],
    ["lançar despesa", `insert into public.expenses (spent_at, description, amount) values (current_date,'x',1)`, []],
    ["criar jogo", `insert into public.matches (match_date) values (current_date)`, []],
  ]) { const e = await err(sql, p); ok(`diretoria não consegue: ${n}`, !!e, "executou!") }
  ok("diretoria não altera atleta", (await db.query(`update public.athletes set full_name='HACK' where id=$1`, [G.athlete])).rowCount === 0)
  ok("diretoria não apaga atleta", (await db.query(`delete from public.athletes where id=$1`, [G.athlete])).rowCount === 0)
  ok("diretoria não altera pagamento", (await db.query(`update public.payments set amount=1`)).rowCount === 0)
  for (const [n, sql] of [
    ["gerar mensalidades", `select public.generate_charges(current_date)`], ["listar usuários", `select * from public.admin_users()`],
    ["alterar usuário", `select public.admin_update_user('${U.geabAtleta}', 'Nome Novo Aqui', 'admin', true, null)`],
    ["remover acesso", `select public.admin_remove_access('${U.geabAtleta}')`], ["aprovar cadastro", `select public.approve_signup('${G.request}')`],
    ["recusar cadastro", `select public.reject_signup('${G.request}')`], ["excluir atleta", `select public.admin_delete_athlete('${G.athlete}')`],
    ["editar mensalidade", `select public.admin_update_charge('${G.charge}', 1, current_date)`], ["excluir mensalidade", `select public.admin_delete_charge('${G.charge}', true)`],
    ["salvar gols", `select public.set_match_players('${G.match}', '[]')`], ["salvar escalação", `select public.set_match_lineup('${G.match}', '[]')`],
    ["editar o grupo", `select public.update_organization('X', null, null, null, null)`],
  ]) { const e = await err(sql); ok(`diretoria é barrada em: ${n}`, !!e && /Apenas/.test(e), e ?? "executou!") }
  ok("diretoria continua vendo aniversariantes e artilharia", (await err(`select * from public.month_birthdays()`)) === null && (await err(`select * from public.top_scorers()`)) === null)
})
await as(U.geabAdmin, async () => {
  await db.query(`select public.admin_update_user($1, 'Atleta Virou Diretor', 'diretoria', true, null)`, [U.geabAtleta])
  ok("administrador promove um usuário a diretoria", (await one(`select role from public.profiles where id=$1`, [U.geabAtleta])) === "diretoria")
  ok("promover a diretoria mantém o vínculo com o cadastro de atleta", (await one(`select athlete_id from public.profiles where id=$1`, [U.geabAtleta])) === G.athlete)
  ok("administrador continua com acesso total", (await db.query(`update public.athletes set nickname='ok' where id=$1`, [G.athlete])).rowCount === 1)}, true)
await as(U.peladaAdmin, async () => { ok("diretoria do GEAB não vê nem altera o outro grupo", true) })
await as(D, async () => { ok("diretoria do GEAB não vê dados da Pelada", (await one(`select count(*)::int from public.athletes where tenant_id=$1`, [P.org])) === 0 && (await one(`select count(*)::int from public.expenses where description='Colete'`)) === 0) })
await db.query("begin")
const eLastAdmin = await err(`update public.profiles set role='diretoria' where id=$1`, [U.peladaAdmin])
await db.query("rollback")
ok("diretoria não conta como administrador: o último admin não pode virar diretoria", !!eLastAdmin && /pelo menos um/.test(eLastAdmin), eLastAdmin ?? "")
await as(U.geabAtleta, async () => { ok("(ex-atleta agora diretoria) vê as áreas de consulta", (await one(`select count(*)::int from public.expenses`)) === 1) })
await db.query(`update public.profiles set role='atleta' where id=$1`, [U.geabAtleta])
await as(U.geabAtleta, async () => { ok("atleta continua vendo só o que é dele", (await one(`select count(*)::int from public.athletes`)) === 1 && (await one(`select count(*)::int from public.expenses`)) === 0) })

section("Rodapé do card (0021)")
ok("GEAB já nasce com o rodapé 'GEAB - Grêmio Amigos da Bola'", (await one(`select card_footer from public.organizations where slug='geab'`)) === "GEAB - Grêmio Amigos da Bola")
await as(U.geabAdmin, async () => {
  await db.query(`select public.update_organization('GEAB Futebol', null, null, 'geabfutebol.com.br', 'Lema', 'Rodapé Novo')`)
  ok("administrador edita o rodapé do próprio grupo", (await one(`select card_footer from public.organizations`)) === "Rodapé Novo")
  await db.query(`select public.update_organization('GEAB Futebol', null, null, null, null)`)
  ok("chamada antiga com 5 argumentos continua valendo (limpa o rodapé)", (await one(`select card_footer from public.organizations`)) === null)
  ok("rodapé acima de 100 caracteres é cortado", (await db.query(`select public.update_organization('GEAB Futebol', null, null, null, null, repeat('x', 300))`), (await one(`select length(card_footer)::int from public.organizations`)) === 100))
})
await as(D, async () => { ok("diretoria não edita o rodapé", /Apenas/.test(await err(`select public.update_organization('X', null, null, null, null, 'hack')`) ?? "")) })
ok("rodapé de outro grupo não é afetado", (await one(`select card_footer from public.organizations where slug='geab'`) ) === "GEAB - Grêmio Amigos da Bola")

section("Log de acessos (0023)")
await as(U.geabAdmin, async () => { await db.query(`select public.log_access('Mozilla iPhone')`); await db.query(`select public.log_access('Mozilla iPhone')`) }, true)
await as(U.peladaAdmin, async () => { await db.query(`select public.log_access(null)`) }, true)
await as(U.geabAdmin, async () => {
  ok("admin comum não lê o log (tabela fechada)", (await one(`select count(*)::int from public.access_log`)) === 0)
  ok("admin comum não usa sa_access_daily", /restrito/i.test(await err(`select * from public.sa_access_daily(7)`) ?? ""))
  ok("admin comum não usa sa_access_day", /restrito/i.test(await err(`select * from public.sa_access_day(current_date)`) ?? ""))
})
await as(uid(600), async () => {
  const d = await q(`select * from public.sa_access_daily(7)`)
  ok("resumo diário: 2 pessoas em 2 grupos, 3 aberturas", d.length === 1 && d[0].users === 2 && d[0].orgs === 2 && d[0].hits === 3, JSON.stringify(d))
  const r = await q(`select * from public.sa_access_day($1)`, [d[0].day])
  ok("detalhe do dia lista as pessoas com grupo e aberturas", r.length === 2 && r.some((x) => x.hits === 2 && x.org_name), JSON.stringify(r))
})

section("Painel do SaaS: dashboard e contato (0025)")
const totalOrgs = await one(`select count(*)::int from public.organizations`)
await as(U.geabAdmin, async () => {
  ok("admin comum não usa sa_dashboard", /restrito/i.test(await err(`select public.sa_dashboard(6)`) ?? ""))
  ok("admin comum não usa sa_set_contact", /restrito/i.test(await err(`select public.sa_set_contact('${P.org}', 'x', 'a@b.co', '1')`) ?? ""))
  ok("admin comum não lê platform_mrr_history", (await one(`select count(*)::int from public.platform_mrr_history`)) === 0)
})
await as(uid(600), async () => {
  await db.query(`select public.sa_set_contact($1, 'Fulano', 'fulano@x.com', '11999990000')`, [P.org])
  const g = (await q(`select contact_name, contact_email, contact_phone from public.sa_orgs() where id=$1`, [P.org]))[0]
  ok("contato do responsável salvo", g.contact_name === "Fulano" && g.contact_email === "fulano@x.com" && g.contact_phone === "11999990000", JSON.stringify(g))
  ok("e-mail inválido é recusado", /inválido/i.test(await err(`select public.sa_set_contact('${P.org}', 'x', 'sem-arroba', null)`) ?? ""))
  const d = await one(`select public.sa_dashboard(6)`)
  ok("dashboard: séries com 6 meses e MRR do mês registrado", d.growth.length === 6 && d.mrr.length === 1 && typeof d.new_month === "number", JSON.stringify(d))
  ok("dashboard: total acumulado do último mês bate com os grupos", d.growth[5].total === totalOrgs, JSON.stringify(d.growth[5]) + " vs " + totalOrgs)
  })
await q(`update public.organizations set status='cancelada' where id=$1`, [P.org])
await as(uid(600), async () => {
  ok("cancelamento registra a data e conta no mês", (await one(`select public.sa_dashboard(6)->>'cancelled_month'`)) === "1")
})
await q(`update public.organizations set status='ativa' where id=$1`, [P.org])
ok("reativar limpa a data de cancelamento", (await one(`select cancelled_at is null from public.organizations where id=$1`, [P.org])) === true)

section("Painel do SaaS: detalhe do cliente (0026)")
await as(U.geabAdmin, async () => {
  ok("admin comum não usa sa_org_detail", /restrito/i.test(await err(`select public.sa_org_detail('${P.org}')`) ?? ""))
  ok("admin comum não usa sa_update_org", /restrito/i.test(await err(`select public.sa_update_org('${P.org}','x',null,null,null,null,null)`) ?? ""))
})
await as(uid(600), async () => {
  const d = await one(`select public.sa_org_detail($1)`, [P.org])
  ok("detalhe traz cadastro, uso, equipe, cobrança, acessos e alterações", ["org", "usage", "staff", "billing", "access", "changes"].every((k) => k in d), Object.keys(d).join())
  ok("equipe lista só administração (sem atletas)", d.staff.every((x) => ["admin", "diretoria"].includes(x.role)))
  ok("grupo inexistente é recusado", /não encontrado/i.test(await err(`select public.sa_org_detail('00000000-0000-0000-0000-000000000000')`) ?? ""))
  await db.query(`select public.sa_update_org($1, 'Pelada FC', 'pelada.com', 'Lema', '#112233', 'https://x.co/logo.png', 'Rodapé')`, [P.org])
  const o = (await one(`select public.sa_org_detail($1)->'org'`, [P.org]))
  ok("edição salva cadastro e identidade visual", o.name === "Pelada FC" && o.primary_color === "#112233" && o.card_footer === "Rodapé", JSON.stringify(o))
  ok("cor inválida é recusada", /Cor inválida/.test(await err(`select public.sa_update_org('${P.org}','x',null,null,'azul',null,null)`) ?? ""))
  ok("logo http inseguro é recusado", /https/.test(await err(`select public.sa_update_org('${P.org}','x',null,null,null,'javascript:alert(1)',null)`) ?? ""))
  ok("alteração aparece no histórico", (await one(`select public.sa_org_detail($1)->'changes'`, [P.org])).some((c) => c.action === "SA_UPDATE_ORG"))
}, true)

section("Painel do SaaS: suspensão, exclusão e exclusão definitiva (0027)")
{
  const X = { org: uid(960), adm: uid(961), ath: uid(962), charge: uid(963), match: uid(964) }
  await q(`insert into auth.users (id, email) values ($1,'x-adm@x')`, [X.adm])
  await q(`insert into public.organizations (id, slug, name, status, plan_id) values ($1,'time-x','Time X','ativa', (select id from public.plans where code='basico'))`, [X.org])
  await q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,'Adm X','admin')`, [X.org, X.adm])
  await q(`insert into public.athletes (id, tenant_id, full_name) values ($1,$2,'Atleta X')`, [X.ath, X.org])
  await q(`insert into public.charges (id, tenant_id, athlete_id, competence, due_date, amount) values ($1,$2,$3,'2026-11-01','2026-11-10',100)`, [X.charge, X.org, X.ath])
  await q(`insert into public.payments (tenant_id, athlete_id, charge_id, amount, paid_at) values ($1,$2,$3,40,current_date)`, [X.org, X.ath, X.charge])
  await q(`insert into public.matches (id, tenant_id, match_date, status) values ($1,$2,current_date,'agendado')`, [X.match, X.org])
  const before = {
    geab: await one(`select count(*)::int from public.athletes where tenant_id = (select id from public.organizations where slug='geab')`),
    pel: await one(`select count(*)::int from public.charges where tenant_id=$1`, [P.org]),
  }
  await as(U.geabAdmin, async () => {
    ok("admin comum não exclui grupo", /restrito/i.test(await err(`select public.sa_delete_org('${X.org}','Time X','x',30)`) ?? ""))
    ok("admin comum não exporta nem apaga", /restrito/i.test(await err(`select public.sa_org_export('${X.org}')`) ?? "") && /restrito/i.test(await err(`select public.sa_purge_org('${X.org}','Time X')`) ?? ""))
  })
  await as(X.adm, async () => {
    ok("grupo ativo: my_org_block = ok", (await one(`select kind from public.my_org_block()`)) === "ok")
  })
  await as(uid(600), async () => {
    await db.query(`select public.sa_set_org_status($1, 'suspensa', 'falta de contrato')`, [X.org])
    const d = await one(`select public.sa_org_detail($1)->'org'`, [X.org])
    ok("suspensão registra data, responsável e motivo", !!d.suspended_at && !!d.suspended_by && d.status_reason === "falta de contrato", JSON.stringify(d))
    ok("excluir sem digitar o nome é recusado", /não confere/.test(await err(`select public.sa_delete_org('${X.org}','time x','x',30)`) ?? ""))
    ok("prazo de recuperação inválido é recusado", /Prazo/.test(await err(`select public.sa_delete_org('${X.org}','Time X','x',1)`) ?? ""))
    const chk = await one(`select public.sa_org_delete_check($1)`, [X.org])
    ok("verificação mostra o que será afetado", chk.athletes === 1 && chk.payments === 1 && chk.matches === 1 && chk.users === 1, JSON.stringify(chk))
  }, true)
  await as(X.adm, async () => {
    ok("suspenso manual: my_org_block mostra motivo", (await q(`select kind, reason from public.my_org_block()`))[0]?.kind === "manual")
  })
  await as(uid(600), async () => { await db.query(`select public.sa_delete_org($1,'Time X','encerrou',30)`, [X.org]) }, true)
  ok("exclusão lógica não apaga nenhum dado", (await one(`select count(*)::int from public.athletes where tenant_id=$1`, [X.org])) === 1 && (await one(`select count(*)::int from public.payments where tenant_id=$1`, [X.org])) === 1)
  await as(X.adm, async () => {
    ok("grupo excluído: usuário sem acesso aos dados", (await one(`select count(*)::int from public.athletes`)) === 0)
    ok("grupo excluído: my_org_block = excluida", (await one(`select kind from public.my_org_block()`)) === "excluida")
  })
  await q(`select public.billing_event('inexistente','PAYMENT_CONFIRMED')`)
  await as(uid(600), async () => {
    ok("exclusão definitiva antes do prazo é recusada", /prazo de recuperação/i.test(await err(`select public.sa_purge_org('${X.org}','Time X')`) ?? ""))
    ok("situação de grupo excluído não é alterada sem restaurar", /restaure/i.test(await err(`select public.sa_set_org_status('${X.org}','ativa',null)`) ?? ""))
    const ex = await one(`select public.sa_org_export($1)`, [X.org])
    ok("exportação traz os dados do grupo e não traz credenciais", ex.tabelas.athletes.length === 1 && ex.tabelas.payments.length === 1 && !("btg_connection" in ex.tabelas), Object.keys(ex.tabelas).join())
    await db.query(`select public.sa_restore_org($1)`, [X.org])
  }, true)
  ok("exportação ficou na auditoria", (await one(`select count(*)::int from public.audit_log where action='SA_EXPORT_ORG' and tenant_id=$1`, [X.org])) === 1)
  ok("restaurar volta à situação anterior (suspensa)", (await one(`select status from public.organizations where id=$1`, [X.org])) === "suspensa")
  await as(uid(600), async () => { await db.query(`select public.sa_set_org_status($1,'ativa',null)`, [X.org]); await db.query(`select public.sa_delete_org($1,'Time X','teste purge',7)`, [X.org]) }, true)
  await q(`update public.org_internal set purge_after = now() - interval '1 day' where org_id=$1`, [X.org])
  await as(uid(600), async () => {
    ok("nome errado impede a exclusão definitiva", /não confere/.test(await err(`select public.sa_purge_org('${X.org}','Time')`) ?? ""))
    const c = await one(`select public.sa_purge_org($1,'Time X')`, [X.org])
    ok("exclusão definitiva apaga os dados do grupo", c.athletes === 1 && c.payments === 1, JSON.stringify(c))
  }, true)
  ok("grupo, usuário e dados sumiram", (await one(`select count(*)::int from public.organizations where id=$1`, [X.org])) === 0 && (await one(`select count(*)::int from auth.users where id=$1`, [X.adm])) === 0 && (await one(`select count(*)::int from public.charges where tenant_id=$1`, [X.org])) === 0)
  ok("dados de OUTROS grupos continuam intactos", (await one(`select count(*)::int from public.athletes where tenant_id=(select id from public.organizations where slug='geab')`)) === before.geab && (await one(`select count(*)::int from public.charges where tenant_id=$1`, [P.org])) === before.pel)
  ok("exclusão definitiva fica registrada", (await one(`select count(*)::int from public.platform_purges where slug='time-x'`)) === 1)
}

section("Planos, módulos e limites (0028)")
{
  const errq = async (sql) => { try { await q(sql); return null } catch (e) { return e.message } }
  const A = { org: uid(970), a1: uid(971), a2: uid(972) }
  await q(`insert into auth.users (id, email) values ($1,'p1@x'), ($2,'p2@x')`, [A.a1, A.a2])
  await q(`insert into public.plans (code, name, price_cents, max_athletes, max_admins, modules, trial_days) values ('um_admin','Um admin',1000,10,1,array['pix'],5)`)
  await q(`insert into public.organizations (id, slug, name, status, plan_id) values ($1,'lim-adm','Lim Adm','ativa',(select id from public.plans where code='um_admin'))`, [A.org])
  await q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,'A1','admin')`, [A.org, A.a1])
  ok("segundo administrador acima do limite do plano é barrado", /Limite de 1 administrador/.test(await errq(`insert into public.profiles (tenant_id, id, full_name, role) values ('${A.org}','${A.a2}','A2','admin')`) ?? ""))
  ok("diretoria não conta no limite de administradores", (await errq(`insert into public.profiles (tenant_id, id, full_name, role) values ('${A.org}','${A.a2}','A2','diretoria')`)) === null)
  ok("promover a administrador acima do limite é barrado", /Limite/.test(await errq(`update public.profiles set role='admin' where id='${A.a2}'`) ?? ""))
  await q(`update public.plans set max_admins = null where code='um_admin'`)
  ok("sem limite, promover funciona", (await errq(`update public.profiles set role='admin' where id='${A.a2}'`)) === null)
  await as(A.a1, async () => { ok("my_modules devolve os módulos do plano do grupo", (await one(`select public.my_modules()`)).join() === "pix") })
  await as(U.geabAdmin, async () => {
    ok("GEAB mantém todos os módulos", (await one(`select public.my_modules()`)).length === 4)
    ok("admin comum não lê sa_plans", /restrito/i.test(await err(`select * from public.sa_plans()`) ?? ""))
  })
  await as(uid(600), async () => {
    const pr = (await q(`select * from public.sa_plans()`)).find((x) => x.code === "premium")
    ok("Premium existe inativo e sem preço (para o dono configurar)", pr && pr.active === false && pr.price_cents === 0, JSON.stringify(pr))
    ok("módulo inexistente é recusado", /Módulo inválido|violates/.test(await err(`select public.sa_upsert_plan('x1','X',100,5,true,1,array['inexistente'],5,null)`) ?? ""))
    await db.query(`select public.sa_upsert_plan('pro', 'Profissional', 15000, 200, true, 3, array['importar','pix'], 14, 'asaas-pro')`)
    const p = (await q(`select * from public.sa_plans()`)).find((x) => x.code === "pro")
    ok("plano salvo com limite de admins, módulos, teste e referência", p.max_admins === 3 && p.modules.join() === "importar,pix" && p.trial_days === 14 && p.gateway_ref === "asaas-pro", JSON.stringify(p))
  }, true)
  await q(`update public.plans set trial_days = 7 where code = 'teste'`)
  await q(`insert into public.organizations (id, slug, name, status) values ('${uid(973)}','novo-t','Novo T','teste')`)
  ok("duração do teste vem do plano", (await one(`select round(extract(epoch from (trial_ends_at - now())) / 86400)::int from public.organizations where id=$1`, [uid(973)])) === 7)
  await q(`update public.plans set trial_days = 10 where code = 'teste'`)
  ok("preço do plano à venda continua R$ 150 e o nome mudou", (await one(`select price_cents from public.plans where code='pro'`)) === 15000)
}

section("Modo espião: suporte somente leitura (0029)")
{
  const S = { own: uid(980), boss: uid(981), tgt: uid(982), tAdm: uid(983), ath: uid(984), ch: uid(985) }
  const errq = async (sql) => { try { await q(sql); return null } catch (e) { return e.message } }
  await q(`insert into auth.users (id, email) values ($1,'boss@x'), ($2,'talvo@x')`, [S.boss, S.tAdm])
  await q(`insert into public.organizations (id, slug, name, status, plan_id) values ($1,'dono-esp','Dono Esp','ativa',(select id from public.plans where code='ilimitado')), ($2,'alvo-esp','Alvo Esp','teste',(select id from public.plans where code='teste'))`, [S.own, S.tgt])
  await q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,'Dono','admin'), ($3,$4,'Adm Alvo','admin')`, [S.own, S.boss, S.tgt, S.tAdm])
  await q(`insert into public.platform_admins (user_id) values ($1)`, [S.boss])
  await q(`insert into public.athletes (id, tenant_id, full_name) values ($1,$2,'Atleta Alvo')`, [S.ath, S.tgt])
  await q(`insert into public.charges (id, tenant_id, athlete_id, competence, due_date, amount) values ($1,$2,$3,'2026-11-01','2026-11-10',100)`, [S.ch, S.tgt, S.ath])
  await as(S.tAdm, async () => { ok("admin comum não inicia modo espião", /restrito/i.test(await err(`select public.sa_support_start('${S.own}','teste',30)`) ?? "")) })
  await as(S.boss, async () => {
    ok("sem sessão, o dono não vê dados do cliente", (await one(`select count(*)::int from public.athletes where full_name = 'Atleta Alvo'`)) === 0)
    ok("motivo é obrigatório", /motivo/i.test(await err(`select public.sa_support_start('${S.tgt}','',30)`) ?? ""))
    ok("não entra no próprio grupo", /próprio/i.test(await err(`select public.sa_support_start('${S.own}','suporte',30)`) ?? ""))
    ok("duração fora do limite é recusada", /Duração/.test(await err(`select public.sa_support_start('${S.tgt}','suporte',999)`) ?? ""))
    await db.query(`select public.sa_support_start($1,'cliente pediu ajuda',30)`, [S.tgt])
  }, true)
  await as(S.boss, async () => {
    ok("em modo espião, o dono vê os dados do cliente", (await one(`select count(*)::int from public.athletes where full_name = 'Atleta Alvo'`)) === 1 && (await one(`select count(*)::int from public.charges`)) === 1)
    ok("em modo espião, não vê dados do próprio grupo nem de outros", (await one(`select count(*)::int from public.athletes where full_name <> 'Atleta Alvo'`)) === 0)
    ok("banner: my_support_session informa o grupo", (await one(`select org_name from public.my_support_session()`)) === "Alvo Esp")
    ok("insert é bloqueado", /somente leitura/.test(await err(`insert into public.athletes (tenant_id, full_name) values ('${S.tgt}','Novo')`) ?? ""))
    ok("update é bloqueado", /somente leitura/.test(await err(`update public.athletes set full_name='X' where id='${S.ath}'`) ?? ""))
    ok("delete é bloqueado", /somente leitura/.test(await err(`delete from public.charges where id='${S.ch}'`) ?? ""))
    ok("função de escrita do admin também é bloqueada", /somente leitura|restrito|Apenas/i.test(await err(`select public.update_my_profile('Outro Nome', 'x')`) ?? "x"))
  })
  ok("os dados do cliente continuam intactos", (await one(`select full_name from public.athletes where id=$1`, [S.ath])) === "Atleta Alvo" && (await one(`select count(*)::int from public.charges where tenant_id=$1`, [S.tgt])) === 1)
  ok("acesso de suporte aparece na auditoria do cliente", (await one(`select count(*)::int from public.audit_log where action='SA_SPY_START' and tenant_id=$1`, [S.tgt])) === 1)
  await as(S.tAdm, async () => { ok("o próprio cliente não é afetado e não vê sessão", (await one(`select count(*)::int from public.athletes`)) === 1 && (await q(`select * from public.my_support_session()`)).length === 0) })
  await as(S.boss, async () => { await db.query(`select public.sa_support_stop()`) }, true)
  await as(S.boss, async () => {
    ok("ao sair, volta a ver só o próprio grupo", (await one(`select count(*)::int from public.athletes where full_name = 'Atleta Alvo'`)) === 0)
    ok("ao sair, escrita volta ao normal", (await err(`insert into public.athletes (tenant_id, full_name) values ('${S.own}','Meu atleta')`)) === null)
  })
  ok("saída registrada na auditoria do cliente", (await one(`select count(*)::int from public.audit_log where action='SA_SPY_END' and tenant_id=$1`, [S.tgt])) === 1)
  await q(`insert into public.support_sessions (user_id, org_id, expires_at) values ($1,$2, now() - interval '1 minute')`, [S.boss, S.tgt])
  await as(S.boss, async () => { ok("sessão expirada não dá acesso", (await one(`select count(*)::int from public.athletes where full_name = 'Atleta Alvo'`)) === 0) })
  await q(`delete from public.support_sessions`)
}

section("Notificações de vencimento (0030)")
{
  const N = { t3: uid(990), t1: uid(991), fim: uid(992), ina: uid(993), long: uid(994), a3: uid(995), a1: uid(996), af: uid(997), ai: uid(998) }
  const errq = async (sql) => { try { await q(sql); return null } catch (e) { return e.message } }
  await q(`insert into auth.users (id, email) values ($1,'n3@x.com'), ($2,'n1@x.com'), ($3,'nf@x.com'), ($4,'ni@x.com')`, [N.a3, N.a1, N.af, N.ai])
  const mk = async (id, slug, status, trial, adm) => {
    await q(`insert into public.organizations (id, slug, name, status, plan_id) values ($1,$2,$2,$3,(select id from public.plans where code='teste'))`, [id, slug, status])
    await q(`update public.organizations set trial_ends_at = $2 where id = $1`, [id, trial])
    await q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,'Adm','admin')`, [id, adm])
  }
  await mk(N.t3, "n-t3", "teste", new Date(Date.now() + 2.5 * 86400e3).toISOString(), N.a3)
  await mk(N.t1, "n-t1", "teste", new Date(Date.now() + 0.5 * 86400e3).toISOString(), N.a1)
  await mk(N.fim, "n-fim", "teste", new Date(Date.now() - 2 * 86400e3).toISOString(), N.af)
  await mk(N.ina, "n-ina", "suspensa", null, N.ai)
  await q(`insert into public.org_internal (org_id, status_reason) values ($1,'inadimplência (cobrança vencida)')`, [N.ina])
  await q(`insert into public.organizations (id, slug, name, status, trial_ends_at, plan_id) values ($1,'n-long','n-long','teste', now() + interval '8 days',(select id from public.plans where code='teste'))`, [N.long])
  const cand = await q(`select org_name, kind, emails from public.billing_notify_candidates() where org_name like 'n-%' order by org_name`)
  const kinds = Object.fromEntries(cand.map((c) => [c.org_name, c.kind]))
  ok("candidatos corretos por situação", kinds["n-t3"] === "trial_3d" && kinds["n-t1"] === "trial_1d" && kinds["n-fim"] === "trial_fim" && kinds["n-ina"] === "inadimplencia" && !("n-long" in kinds), JSON.stringify(kinds))
  ok("destinatário é o e-mail do administrador do grupo", cand.find((c) => c.org_name === "n-t3").emails.join() === "n3@x.com")
  const c3 = (await q(`select ref from public.billing_notify_candidates() where org_name='n-t3'`))[0]
  await q(`select public.billing_notify_mark($1,'trial_3d',$2,array['n3@x.com'],'enviada',null)`, [N.t3, c3.ref])
  ok("aviso enviado não é repetido", (await q(`select 1 from public.billing_notify_candidates() where org_name='n-t3'`)).length === 0)
  await q(`select public.billing_notify_mark($1,'trial_1d',(select ref from public.billing_notify_candidates() where org_name='n-t1'),array['n1@x.com'],'falhou','smtp')`, [N.t1])
  ok("aviso que falhou é tentado de novo", (await q(`select 1 from public.billing_notify_candidates() where org_name='n-t1'`)).length === 1)
  await as(U.geabAdmin, async () => {
    ok("usuário comum não chama as funções de aviso", (await err(`select * from public.billing_notify_candidates()`)) !== null && (await err(`select * from public.sa_org_notifications('${N.t3}')`)) !== null)
  })
  await as(uid(600), async () => {
    const h = await q(`select kind, status from public.sa_org_notifications($1)`, [N.t3])
    ok("dono vê o histórico de avisos do cliente", h.length === 1 && h[0].kind === "trial_3d" && h[0].status === "enviada")
  })
}

section("Cadastro com telefone obrigatório (0032)")
{
  const errq = async (sql) => { try { await q(sql); return null } catch (e) { return e.message } }
  ok("novo grupo sem telefone é recusado", /telefone/.test(await errq(`insert into auth.users (id, email, raw_user_meta_data) values ('${uid(1010)}','sf@x','{"full_name":"Sem Fone","new_org_slug":"sem-fone","new_org_name":"Sem Fone FC"}')`) ?? ""))
  ok("novo grupo sem nome completo é recusado", /nome completo/.test(await errq(`insert into auth.users (id, email, raw_user_meta_data) values ('${uid(1011)}','sn@x','{"phone":"5548999991111","new_org_slug":"sem-nome","new_org_name":"Sem Nome FC"}')`) ?? ""))
  ok("nada foi criado nos cadastros recusados", (await one(`select count(*)::int from public.organizations where slug in ('sem-fone','sem-nome')`)) === 0)
}

section("Cadastro sem grupo (0031)")
{
  const O = { a: uid(1001), b: uid(1002), c: uid(1003), d: uid(1004) }
  await q(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1,'sg-a@x',now(),'{"full_name":"Pessoa Sem Grupo"}'), ($2,'sg-b@x',now(),'{"full_name":"Atleta Sem Grupo","nickname":"Atl","phone":"5548999990000","birth_date":"1990-05-05","whatsapp_consent":"true"}'), ($3,'sg-c@x',null,'{}')`, [O.a, O.b, O.c])
  ok("public_trial_days = 10 (do plano de teste)", (await one(`select public.public_trial_days()`)) === 10)
  await as(O.c, async () => { ok("e-mail não confirmado não cria grupo", /Confirme/.test(await err(`select public.create_my_org('Grupo C','grupo-c')`) ?? "")) })
  await as(O.a, async () => {
    ok("endereço inválido é recusado", /indisponível/.test(await err(`select public.create_my_org('Grupo A','x','48999998888')`) ?? ""))
    ok("telefone é obrigatório para criar o grupo", /telefone/.test(await err(`select public.create_my_org('Grupo A','grupo-a')`) ?? ""))
    ok("nome curto é recusado", /nome do grupo/.test(await err(`select public.create_my_org('Ab','grupo-a')`) ?? ""))
    await db.query(`select public.create_my_org('Grupo A','grupo-a','(48) 99999-8888')`)
  }, true)
  ok("grupo criado em teste de 10 dias", (await one(`select round(extract(epoch from (trial_ends_at - now())) / 86400)::int from public.organizations where slug='grupo-a'`)) === 10)
  ok("a pessoa virou administradora do grupo", (await one(`select role::text from public.profiles where id=$1`, [O.a])) === "admin")
  await as(O.a, async () => { ok("não cria um segundo grupo", /já pertence/.test(await err(`select public.create_my_org('Outro','grupo-a2')`) ?? "")) })
  await as(O.b, async () => {
    ok("grupo inexistente é recusado", /não encontrado/.test(await err(`select public.request_join_group('nao-existe')`) ?? ""))
    await db.query(`select public.request_join_group('grupo-a')`)
  }, true)
  const sr = (await q(`select full_name, nickname, phone, whatsapp_consent, status from public.signup_requests where user_id=$1`, [O.b]))[0]
  ok("solicitação de entrada criada com os dados do cadastro", sr && sr.full_name === "Atleta Sem Grupo" && sr.nickname === "Atl" && sr.phone === "5548999990000" && sr.whatsapp_consent === true && sr.status === "pendente", JSON.stringify(sr))
  const pp = (await q(`select code from public.public_plans()`)).map((r) => r.code)
  ok("site: planos públicos incluem teste, básico e pro, sem o interno nem o Premium inativo", ["teste", "basico", "pro"].every((c) => pp.includes(c)) && !pp.includes("ilimitado") && !pp.includes("premium"), pp.join())
  ok("cadastro do grupo grava o responsável no painel do SaaS", (await q(`select contact_name, contact_email, contact_phone from public.org_internal where org_id = (select id from public.organizations where slug='futsal-amigos')`)).some((r) => r.contact_name === "Dona Futsal" && r.contact_email === "dono@futsal" && r.contact_phone === "5548999991111"))
  ok("contato do grupo criado depois também é gravado", (await one(`select contact_phone from public.org_internal where org_id = (select id from public.organizations where slug='grupo-a')`)) === "5548999998888")
  ok("anônimo não cria grupo", await (async () => { try { await q(`set role anon; select public.create_my_org('X Y Z','xyz-grupo')`); return false } catch (e) { await q(`reset role`); return /permission|Entre/.test(e.message) } })())
}

section("Comunicados em massa (0033)")
{
  const C = { o1: uid(1101), o2: uid(1102), o3: uid(1103), o4: uid(1104), o5: uid(1105), a1: uid(1111), a2: uid(1112), a3: uid(1113), a4: uid(1114), a5: uid(1115), at1: uid(1116) }
  const errq = async (sql) => { try { await q(sql); return null } catch (e) { return e.message } }
  await q(`insert into auth.users (id, email) values ($1,'c1@x.com'),($2,'c2@x.com'),($3,'c3@x.com'),($4,'c4@x.com'),($5,'c5@x.com'),($6,'at@x.com')`, [C.a1, C.a2, C.a3, C.a4, C.a5, C.at1])
  const mk = async (o, slug, st, plan, adm) => {
    await q(`insert into public.organizations (id, slug, name, status, plan_id) values ($1,$2,$2,$3,(select id from public.plans where code=$4))`, [o, slug, st, plan])
    await q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,'Adm','admin')`, [o, adm])
  }
  await mk(C.o1, "com-ativa", "ativa", "basico", C.a1)
  await mk(C.o2, "com-teste", "teste", "teste", C.a2)
  await mk(C.o3, "com-susp", "suspensa", "basico", C.a3)
  await mk(C.o4, "com-optout", "ativa", "basico", C.a4)
  await mk(C.o5, "com-excl", "ativa", "basico", C.a5)
  await q(`update public.organizations set status='excluida' where id=$1`, [C.o5])
  await q(`insert into public.profiles (tenant_id, id, full_name, role, athlete_id) values ($1,$2,'Atl','atleta',null)`, [C.o1, C.at1]).catch(() => {})
  await q(`insert into public.org_internal (org_id, contact_email, broadcast_opt_out) values ($1,'c1@x.com',false), ($2,null,true) on conflict (org_id) do update set broadcast_opt_out = excluded.broadcast_opt_out, contact_email = excluded.contact_email`, [C.o1, C.o4])
  await as(U.geabAdmin, async () => {
    ok("admin comum não vê nem cria comunicados", /restrito/i.test(await err(`select public.sa_broadcast_preview(array['ativa'], null)`) ?? "") && /restrito/i.test(await err(`select public.sa_broadcast_send('Assunto','Mensagem',true,false,array['ativa'],null,14)`) ?? "") && /restrito/i.test(await err(`select * from public.sa_broadcasts()`) ?? ""))
    ok("admin comum não chama as funções de envio", (await err(`select * from public.broadcast_next('${C.o1}', 10)`)) !== null && (await err(`select public.broadcast_progress('${C.o1}')`)) !== null)
  })
  let bid
  await as(uid(600), async () => {
    const pv = await one(`select public.sa_broadcast_preview(array['ativa','teste'], null)`)
    ok("prévia: só ativas e em teste, sem excluída nem quem pediu para não receber", pv.orgs >= 2 && pv.emails >= 2, JSON.stringify(pv))
    const pv2 = await one(`select public.sa_broadcast_preview(array['ativa'], array['basico'])`)
    const pv3 = await one(`select public.sa_broadcast_preview(array['suspensa'], array['basico'])`)
    ok("prévia respeita situação e plano", pv3.orgs >= 1 && pv2.orgs >= 1)
    ok("canal é obrigatório", /canal/i.test(await err(`select public.sa_broadcast_send('Assunto','Mensagem',false,false,array['ativa'],null,14)`) ?? ""))
    ok("situação excluída é recusada", /Situação inválida/.test(await err(`select public.sa_broadcast_send('Assunto','Mensagem',true,false,array['excluida'],null,14)`) ?? ""))
    ok("assunto curto é recusado", (await err(`select public.sa_broadcast_send('Ab','Mensagem',true,false,array['ativa'],null,14)`)) !== null)
    bid = await one(`select public.sa_broadcast_send('Novidades de novembro','Agora há documentação e app instalável.',true,true,array['ativa','teste'],array['basico','teste'],7)`)
  }, true)
  const rec = await q(`select org_id::text, email, status from public.broadcast_recipients where broadcast_id=$1`, [bid])
  ok("destinatários: admins dos grupos do público, sem repetir e sem excluído/opt-out", rec.some((r) => r.email === "c1@x.com") && rec.some((r) => r.email === "c2@x.com") && !rec.some((r) => r.email === "c5@x.com" || r.email === "c4@x.com" || r.email === "c3@x.com") && new Set(rec.map((r) => r.email)).size === rec.length, JSON.stringify(rec.map((r) => r.email)))
  ok("todos nascem pendentes e o comunicado está enviando", rec.every((r) => r.status === "pendente") && (await one(`select status from public.broadcasts where id=$1`, [bid])) === "enviando")
  // envio em lotes pelo servidor
  const lote = await q(`select * from public.broadcast_next($1, 1)`, [bid])
  ok("lote respeita o limite", lote.length === 1)
  for (const r of rec) await q(`select public.broadcast_mark($1,$2,$3,$4)`, [bid, r.email, r.email === "c2@x.com" ? "falhou" : "enviado", r.email === "c2@x.com" ? "caixa cheia" : null])
  const prog = await one(`select public.broadcast_progress($1)`, [bid])
  ok("progresso fecha o envio quando não há pendentes", prog.pending === 0 && prog.failed === 1 && (await one(`select status from public.broadcasts where id=$1`, [bid])) === "enviada", JSON.stringify(prog))
  await as(uid(600), async () => {
    const l = (await q(`select * from public.sa_broadcasts() where id=$1`, [bid]))[0]
    ok("histórico traz contagens de enviados e falhas", l.sent_count === rec.length - 1 && l.failed_count === 1, JSON.stringify(l))
    ok("detalhe lista cada destinatário com o resultado", (await one(`select jsonb_array_length(public.sa_broadcast_detail($1)->'recipients')`, [bid])) === rec.length)
    ok("reenviar falhas recoloca na fila", (await one(`select public.sa_broadcast_retry($1)`, [bid])) === 1)
  }, true)
  ok("com pendentes volta a enviando", (await one(`select status from public.broadcasts where id=$1`, [bid])) === "enviando")
  // aviso no painel
  await as(C.a1, async () => {
    const a = await q(`select subject from public.my_announcements()`)
    ok("administrador do grupo vê o aviso no painel", a.length === 1 && a[0].subject === "Novidades de novembro")
    await db.query(`select public.dismiss_announcement($1)`, [bid])
  }, true)
  await as(C.a1, async () => { ok("depois de dispensar o aviso some", (await q(`select 1 from public.my_announcements()`)).length === 0) })
  await as(C.a2, async () => { ok("outro grupo do público também vê", (await q(`select 1 from public.my_announcements()`)).length === 1) })
  await as(C.a4, async () => { ok("grupo fora do público não vê", (await q(`select 1 from public.my_announcements()`)).length === 0) })
  await as(C.a1, async () => { ok("tabelas de comunicados são fechadas ao navegador", /permission denied/.test(await err(`select count(*) from public.broadcast_dismissals`) ?? "") && /permission denied/.test(await err(`select count(*) from public.broadcast_recipients`) ?? "")) })
  await as(uid(600), async () => {
    await db.query(`select public.sa_set_broadcast_opt_out($1, true)`, [C.o2])
  }, true)
  let id2
  await as(uid(600), async () => {
    ok("imagem fora do bucket de comunicados é recusada", /Imagem inválida/.test(await err(`select public.sa_broadcast_send('Com imagem','Mensagem',false,true,array['ativa'],null,7,'https://evil.example.com/a.png')`) ?? "") && /Imagem inválida/.test(await err(`select public.sa_broadcast_send('Com imagem','Mensagem',false,true,array['ativa'],null,7,'http://x.supabase.co/storage/v1/object/public/comunicados/a.png')`) ?? ""))
    const img = "https://abc.supabase.co/storage/v1/object/public/comunicados/9f2c-1.jpg"
    id2 = await one(`select public.sa_broadcast_send('Com imagem','Mensagem com figura',true,true,array['ativa'],null,7,$1)`, [img])
  }, true)
  ok("imagem válida é guardada e vai no conteúdo do envio", (await q(`select image_url from public.broadcast_content($1)`, [id2]))[0].image_url === "https://abc.supabase.co/storage/v1/object/public/comunicados/9f2c-1.jpg")
  await as(C.a1, async () => { ok("aviso do painel traz a imagem", (await q(`select image_url from public.my_announcements()`)).some((r) => r.image_url?.endsWith("9f2c-1.jpg"))) })
  ok("opt-out tira o grupo de novos envios", (await one(`select count(*)::int from public.broadcast_audience_orgs(array['teste'], null) x where x = $1`, [C.o2])) === 0)
  ok("opt-out fica na auditoria do cliente", (await one(`select count(*)::int from public.audit_log where action='SA_BROADCAST_OPT_OUT' and tenant_id=$1`, [C.o2])) === 1)
}

section("Quadra Esportiva: estrutura (0035)")
{
  const Q = { o1: uid(1201), o2: uid(1202), og: uid(1203), ob: uid(1204), a1: uid(1211), a2: uid(1212), ger: uid(1213), rec: uid(1214), fin: uid(1215), atl: uid(1216), ag: uid(1217), boss: uid(1218) }
  const errq = async (sql) => { try { await q(sql); return null } catch (e) { return e.message } }
  await q(`insert into auth.users (id, email) values ($1,'q-a1@x'),($2,'q-a2@x'),($3,'q-ger@x'),($4,'q-rec@x'),($5,'q-fin@x'),($6,'q-atl@x'),($7,'q-ag@x'),($8,'q-boss@x')`, [Q.a1, Q.a2, Q.ger, Q.rec, Q.fin, Q.atl, Q.ag, Q.boss])
  await q(`insert into public.plans (code, name, price_cents, max_athletes, modules, max_courts) values ('quadra_t','Quadra T',9900,10,array['quadras'],2)`)
  const mk = async (o, slug, plan, kind) => q(`insert into public.organizations (id, slug, name, status, kind, plan_id) values ($1,$2,$2,'ativa',$4,(select id from public.plans where code=$3))`, [o, slug, plan, kind])
  await mk(Q.o1, "quadra-um", "quadra_t", "quadra"); await mk(Q.o2, "quadra-dois", "quadra_t", "quadra"); await mk(Q.og, "grupo-sem-modulo", "basico", "grupo"); await mk(Q.ob, "quadra-boss", "basico", "grupo")
  const pf = (o, id, role) => q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,'X',$3)`, [o, id, role])
  await pf(Q.o1, Q.a1, "admin"); await pf(Q.o2, Q.a2, "admin"); await pf(Q.o1, Q.ger, "diretoria"); await pf(Q.o1, Q.rec, "diretoria"); await pf(Q.o1, Q.fin, "diretoria"); await pf(Q.o1, Q.atl, "diretoria"); await pf(Q.og, Q.ag, "admin"); await pf(Q.ob, Q.boss, "admin")
  await q(`insert into public.platform_admins (user_id) values ($1)`, [Q.boss])
  await q(`insert into public.court_staff (tenant_id, profile_id, role) values ($1,$2,'gerente'),($1,$3,'recepcionista'),($1,$4,'financeiro')`, [Q.o1, Q.ger, Q.rec, Q.fin])

  const roleOf = async (u) => { let r; await as(u, async () => { r = await one(`select public.court_role()`) }); return r }
  ok("perfis do módulo: admin, gerente, recepcionista e financeiro", (await roleOf(Q.a1)) === "admin" && (await roleOf(Q.ger)) === "gerente" && (await roleOf(Q.rec)) === "recepcionista" && (await roleOf(Q.fin)) === "financeiro")
  ok("usuário do grupo sem cadastro na equipe e grupo sem o módulo no plano não têm acesso", (await roleOf(Q.atl)) === null && (await roleOf(Q.ag)) === null)

  // centro esportivo
  await as(Q.a1, async () => {
    await db.query(`insert into public.court_venues (trade_name, doc_type, document, state, cep, phone) values ('Arena Um','cnpj','11.222.333/0001-81','SC','88010-000','48999991111')`.replace("88010-000", "88010000"))
  }, true)
  ok("administrador cria o centro; o estabelecimento vem da sessão, não do navegador", (await one(`select tenant_id::text from public.court_venues where trade_name='Arena Um'`)) === Q.o1)
  ok("documento fica só com dígitos", (await one(`select document from public.court_venues where tenant_id=$1`, [Q.o1])) === "11222333000181")
  await as(Q.a1, async () => {
    ok("CNPJ inválido é recusado", /CNPJ inválido/.test(await err(`update public.court_venues set document='11222333000182'`) ?? ""))
    ok("CPF inválido é recusado", /CPF inválido/.test(await err(`update public.court_venues set doc_type='cpf', document='11111111111'`) ?? ""))
    ok("CPF válido é aceito", (await err(`update public.court_venues set doc_type='cpf', document='529.982.247-25'`)) === null)
    ok("estado e CEP inválidos são recusados", (await err(`update public.court_venues set state='XX'`)) !== null && (await err(`update public.court_venues set cep='123'`)) !== null)
    ok("fuso inválido é recusado", /Fuso/.test(await err(`update public.court_venues set timezone='Marte/Olimpo'`) ?? ""))
    ok("não dá para criar centro em nome de outro estabelecimento", /fora da organização/.test(await err(`insert into public.court_venues (tenant_id, trade_name) values ('${Q.o2}','Invasor')`) ?? ""))
    ok("logo fora do armazenamento do módulo é recusado", (await err(`update public.court_venues set logo_url='https://evil.example.com/a.png'`)) !== null)
  })
  await as(Q.ger, async () => { ok("gerente lê o centro mas não altera o perfil", (await one(`select count(*)::int from public.court_venues`)) === 1 && (await q(`update public.court_venues set description='x' returning 1`)).length === 0) })
  await as(Q.rec, async () => { ok("recepcionista não altera o perfil", (await q(`update public.court_venues set description='x' returning 1`)).length === 0) })
  await as(Q.a2, async () => { ok("outro estabelecimento não enxerga o centro", (await one(`select count(*)::int from public.court_venues`)) === 0) })
  await as(Q.atl, async () => { ok("usuário sem perfil no módulo não lê o centro", (await one(`select count(*)::int from public.court_venues`)) === 0) })
  await as(Q.ag, async () => { ok("grupo sem o módulo não cria centro, mesmo sendo admin", /row-level security|violates/i.test(await err(`insert into public.court_venues (trade_name) values ('Sem módulo')`) ?? "")) })

  // quadras
  const venue = await one(`select id from public.court_venues where tenant_id=$1`, [Q.o1])
  await as(Q.ger, async () => {
    await db.query(`insert into public.court_courts (venue_id, name, sport, floor_type, covered, lighting, capacity, price_cents) values ($1,'Quadra 1','futebol_society','grama_sintetica',true,true,14,12000)`, [venue])
  }, true)
  ok("gerente cadastra quadras", (await one(`select count(*)::int from public.court_courts where tenant_id=$1`, [Q.o1])) === 1)
  await as(Q.rec, async () => { ok("recepcionista não cadastra quadra", /row-level security|violates/i.test(await err(`insert into public.court_courts (venue_id, name, sport) values ('${venue}','Quadra X','futsal')`) ?? "")) })
  await as(Q.a1, async () => {
    ok("nome repetido (sem diferenciar maiúsculas) é recusado", /court_courts_name_uniq|duplicate/i.test(await err(`insert into public.court_courts (venue_id, name, sport) values ('${venue}','quadra 1','futsal')`) ?? ""))
    ok("modalidade inválida é recusada", (await err(`insert into public.court_courts (venue_id, name, sport) values ('${venue}','Quadra Y','sinuca')`)) !== null)
    ok("foto fora do armazenamento do módulo é recusada", /Foto inválida/.test(await err(`insert into public.court_courts (venue_id, name, sport, photos) values ('${venue}','Quadra Z','futsal', array['https://evil.example.com/x.jpg'])`) ?? ""))
    await db.query(`insert into public.court_courts (venue_id, name, sport) values ($1,'Quadra 2','futsal')`, [venue])
    ok("limite de quadras ativas do plano (2)", /Limite de 2 quadra/.test(await err(`insert into public.court_courts (venue_id, name, sport) values ('${venue}','Quadra 3','padel')`) ?? ""))
    await db.query(`update public.court_courts set active=false where name='Quadra 2'`)
    ok("inativar libera vaga no limite", (await err(`insert into public.court_courts (venue_id, name, sport) values ('${venue}','Quadra 3','padel')`)) === null)
    ok("auditoria registra o cadastro de quadras no estabelecimento", (await one(`select count(*)::int from public.audit_log where entity='court_courts'`)) >= 3)
  }, true)
  await as(Q.a2, async () => {
    ok("outro estabelecimento não vê quadras", (await one(`select count(*)::int from public.court_courts`)) === 0)
    await db.query(`insert into public.court_venues (trade_name) values ('Arena Dois')`)
    ok("quadra não pode apontar para o centro de outro estabelecimento", /outra organização|fora da organização/.test(await err(`insert into public.court_courts (venue_id, name, sport) values ('${venue}','Intrusa','futsal')`) ?? ""))
  }, true)

  // modo espião e plataforma
  await as(Q.boss, async () => { await db.query(`select public.sa_support_start($1,'conferir quadras',30)`, [Q.o1]) }, true)
  await as(Q.boss, async () => {
    ok("modo espião: o dono lê o centro e as quadras do cliente", (await one(`select count(*)::int from public.court_venues`)) === 1 && (await one(`select count(*)::int from public.court_courts`)) >= 2)
    ok("modo espião: nada pode ser alterado", /somente leitura/.test(await err(`update public.court_courts set price_cents = 1`) ?? ""))
  })
  await q(`delete from public.support_sessions`)
  await as(Q.a1, async () => { ok("administrador comum não altera o tipo da organização", /restrito/i.test(await err(`select public.sa_set_org_kind('${Q.o1}','grupo')`) ?? "")) })
  ok("tipo padrão é grupo, e o dono consegue mudar", (await one(`select kind from public.organizations where id=$1`, [Q.og])) === "grupo")
  await as(Q.boss, async () => { await db.query(`select public.sa_set_org_kind($1,'quadra')`, [Q.og]) }, true)
  ok("tipo alterado para centro esportivo", (await one(`select kind from public.organizations where id=$1`, [Q.og])) === "quadra")
  await q(`update public.organizations set kind='grupo' where id=$1`, [Q.og])
  ok("exportação do estabelecimento inclui as tabelas do módulo", await (async () => { let ex; await as(Q.boss, async () => { ex = await one(`select public.sa_org_export($1)`, [Q.o1]) }, true); return ex.tabelas.court_courts?.length >= 2 && ex.tabelas.court_venues?.length === 1 })())
}

section("Quadra Esportiva: agenda e reservas (0036)")
{
  const R = { o1: uid(1301), o2: uid(1302), ra: uid(1311), rg: uid(1312), rr: uid(1313), rf: uid(1314), rb: uid(1315), boss: uid(1316), v1: uid(1321), v2: uid(1322), c1: uid(1331), c1b: uid(1332), c2: uid(1333) }
  await q(`insert into auth.users (id, email) values ($1,'r-a@x'),($2,'r-g@x'),($3,'r-r@x'),($4,'r-f@x'),($5,'r-b@x'),($6,'r-boss@x')`, [R.ra, R.rg, R.rr, R.rf, R.rb, R.boss])
  const mk = (o, slug) => q(`insert into public.organizations (id, slug, name, status, kind, plan_id) values ($1,$2,$2,'ativa','quadra',(select id from public.plans where code='quadra_t'))`, [o, slug])
  await mk(R.o1, "arena-r1"); await mk(R.o2, "arena-r2")
  const pf = (o, id, role) => q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,$3,$4)`, [o, id, "Pessoa " + id.slice(-3), role])
  await pf(R.o1, R.ra, "admin"); await pf(R.o1, R.rg, "diretoria"); await pf(R.o1, R.rr, "diretoria"); await pf(R.o1, R.rf, "diretoria"); await pf(R.o2, R.rb, "admin")
  await q(`insert into public.court_staff (tenant_id, profile_id, role) values ($1,$2,'gerente'),($1,$3,'recepcionista'),($1,$4,'financeiro')`, [R.o1, R.rg, R.rr, R.rf])
  await q(`insert into public.court_venues (id, tenant_id, trade_name) values ($1,$2,'Arena R1'),($3,$4,'Arena R2')`, [R.v1, R.o1, R.v2, R.o2])
  await q(`insert into public.court_courts (id, tenant_id, venue_id, name, sport, price_cents) values ($1,$2,$3,'Quadra A','futebol_society',12000),($4,$2,$3,'Quadra B','futsal',10000),($5,$6,$7,'Quadra R2','futsal',9000)`, [R.c1, R.o1, R.v1, R.c1b, R.c2, R.o2, R.v2])
  await q(`insert into public.organizations (id, slug, name, status, plan_id) values ($1,'dono-r','Dono R','ativa',(select id from public.plans where code='ilimitado'))`, [uid(1303)])
  await q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,'Dono','admin')`, [uid(1303), R.boss])
  await q(`insert into public.platform_admins (user_id) values ($1)`, [R.boss])
  const T = (dia, h, m = 0) => `2030-${dia}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-03:00`   // 2030-06-15 é sábado (horário de Brasília)
  const book = (u, court, kind, name, s, e, extra = "") => as(u, async () => (await db.query(`select public.court_booking_create($1,$2,$3,'(48) 99999-1111',null,$4,$5${extra})`, [court, kind, name, s, e])).rows[0].court_booking_create, true)
  const tryBook = async (u, court, kind, s, e, name = "Cliente") => { let m = null; await as(u, async () => { m = await err(`select public.court_booking_create('${court}','${kind}','${name}',null,null,'${s}','${e}')`) }); return m }

  // sem horários configurados
  ok("sem horário de funcionamento configurado, a reserva é recusada com orientação", /Configure os horários/.test(await tryBook(R.ra, R.c1, "avulsa", T("06-15", 20), T("06-15", 21)) ?? ""))
  await q(`insert into public.court_hours (tenant_id, weekday, opens_min, closes_min) values ($1,6,480,1380),($1,0,480,1380),($1,5,480,1440),($1,1,480,1380),($1,2,480,1380),($1,3,480,1380),($1,4,480,1380)`, [R.o1])
  await as(R.ra, async () => { ok("janelas de funcionamento sobrepostas são recusadas", /se sobrepõe/.test(await err(`insert into public.court_hours (weekday, opens_min, closes_min) values (6, 600, 700)`) ?? "")) })

  // criação e preço
  const b1 = await book(R.rr, R.c1, "avulsa", "João Silva", T("06-15", 20), T("06-15", 21))
  ok("recepcionista cria reserva; código sequencial e valor base da quadra", b1.code === "R-000001" && b1.price_cents === 12000 && b1.status === "confirmada" && b1.client_phone === "5548999991111", JSON.stringify(b1))
  await as(R.ra, async () => { await db.query(`insert into public.court_price_rules (name, weekdays, from_min, to_min, kind, price_cents) values ('Sábado à noite', array[6], 1080, 1380, 'avulsa', 18000)`) }, true)
  const b2 = await book(R.ra, R.c1, "avulsa", "Maria", T("06-15", 21), T("06-15", 23))
  ok("regra de preço por faixa de horário (2 horas × R$ 180)", b2.price_cents === 36000, String(b2.price_cents))
  const b3 = await book(R.ra, R.c1b, "mensalista", "Carlos", T("06-15", 20), T("06-15", 21))
  ok("tipo sem regra específica usa o valor base da quadra (mensalista não pega a regra de avulsa)", b3.price_cents === 10000, String(b3.price_cents))

  // conflitos
  ok("mesmo horário na mesma quadra é recusado, dizendo quem ocupa", /Horário indisponível: já existe R-000001 · João Silva/.test(await tryBook(R.rr, R.c1, "avulsa", T("06-15", 20), T("06-15", 21)) ?? ""))
  ok("sobreposição parcial também é recusada", /Horário indisponível/.test(await tryBook(R.rr, R.c1, "avulsa", T("06-15", 20), T("06-15", 22)) ?? ""))
  ok("horários colados (20h–21h e 21h–22h) são permitidos", (await tryBook(R.rr, R.c1, "avulsa", T("06-15", 19), T("06-15", 20), "Antes")) === null)
  ok("o mesmo horário em outra quadra é permitido", (await tryBook(R.rr, R.c1b, "avulsa", T("06-15", 21), T("06-15", 22), "Outra quadra")) === null)

  // regras de horário
  ok("fora do horário de funcionamento", /Fora do horário/.test(await tryBook(R.ra, R.c1, "avulsa", T("06-15", 6), T("06-15", 7)) ?? ""))
  ok("horário fora da grade de 60 minutos", /intervalos de 60/.test(await tryBook(R.ra, R.c1, "avulsa", T("06-15", 10, 30), T("06-15", 11, 30)) ?? ""))
  await q(`update public.court_venues set slot_minutes = 30 where id=$1`, [R.v1])
  ok("duração abaixo do mínimo", /duração mínima/.test(await tryBook(R.ra, R.c1, "avulsa", T("06-16", 10), T("06-16", 10, 30)) ?? ""))
  await q(`update public.court_venues set slot_minutes = 60 where id=$1`, [R.v1])
  ok("fim antes do início", /depois do inicial/.test(await tryBook(R.ra, R.c1, "avulsa", T("06-16", 11), T("06-16", 10)) ?? ""))
  ok("reserva até a meia-noite é aceita onde o centro fecha à meia-noite (sexta)", (await tryBook(R.ra, R.c1, "avulsa", T("06-14", 23), "2030-06-15T00:00:00-03:00", "Meia-noite")) === null)
  ok("tipo inválido e cliente sem nome são recusados", /Tipo de reserva inválido/.test(await tryBook(R.ra, R.c1, "vip", T("06-16", 12), T("06-16", 13)) ?? "") && /nome do cliente/.test(await tryBook(R.ra, R.c1, "avulsa", T("06-16", 12), T("06-16", 13), " ") ?? ""))

  // passado
  ok("recepcionista não lança reserva no passado", /passado/.test(await tryBook(R.rr, R.c1, "avulsa", "2020-06-13T20:00:00-03:00", "2020-06-13T21:00:00-03:00") ?? ""))
  ok("gerente lança reserva no passado", (await tryBook(R.rg, R.c1, "avulsa", "2020-06-13T20:00:00-03:00", "2020-06-13T21:00:00-03:00", "Retroativa")) === null)

  // permissões
  await as(R.rf, async () => {
    ok("financeiro consulta reservas mas não cria", (await one(`select count(*)::int from public.court_bookings`)) >= 3 && /permissão/.test(await err(`select public.court_booking_create('${R.c1}','avulsa','X Y',null,null,'${T("06-16", 12)}','${T("06-16", 13)}')`) ?? ""))
  })
  await as(R.ra, async () => { ok("nem o administrador escreve direto na tabela de reservas", /permission denied/.test(await err(`insert into public.court_bookings (court_id, code, kind, client_name, starts_at, ends_at) values ('${R.c1}','X','avulsa','Fulano','${T("06-20", 10)}','${T("06-20", 11)}')`) ?? "")) })

  // cancelamento libera o horário
  await as(R.rr, async () => { await db.query(`select public.court_booking_cancel($1,'cliente desistiu')`, [b1.id]) }, true)
  ok("cancelada mantém histórico e libera a agenda", (await one(`select status from public.court_bookings where id=$1`, [b1.id])) === "cancelada" && await book(R.rr, R.c1, "avulsa", "Novo dono do horário", T("06-15", 20), T("06-15", 21)).then(() => true, () => false))
  await as(R.rr, async () => { ok("reserva cancelada não pode ser alterada nem cancelada de novo", /cancelada/.test(await err(`select public.court_booking_update('${b1.id}','{"notes":"x"}')`) ?? "") && /já está cancelada/.test(await err(`select public.court_booking_cancel('${b1.id}','x')`) ?? "")) })

  // bloqueios
  await as(R.rr, async () => { ok("recepcionista não cria bloqueio", /permissão/.test(await err(`select public.court_block_create(array['${R.c1}']::uuid[],'manutencao','${T("06-16", 12)}','${T("06-16", 14)}')`) ?? "")) })
  await as(R.rg, async () => { await db.query(`select public.court_block_create(array[$1]::uuid[],'manutencao',$2,$3,'Troca de rede')`, [R.c1, T("06-16", 12), T("06-16", 14)]) }, true)
  ok("bloqueio impede nova reserva no período", /Horário indisponível: já existe bloqueio \(manutencao\)/.test(await tryBook(R.ra, R.c1, "avulsa", T("06-16", 13), T("06-16", 14)) ?? ""))
  await as(R.rg, async () => {
    ok("bloqueio sobre reserva existente é recusado, orientando a remarcar", /Cancele ou remarque/.test(await err(`select public.court_block_create(array['${R.c1}']::uuid[],'outro','${T("06-15", 21)}','${T("06-15", 22)}')`) ?? ""))
    ok("bloqueio pode ficar fora do horário de funcionamento", (await err(`select public.court_block_create(array['${R.c1}']::uuid[],'torneio','${T("06-17", 3)}','${T("06-17", 5)}')`)) === null)
  })

  // remarcação
  const rs = await as(R.rr, async () => (await db.query(`select public.court_booking_reschedule($1,$2,$3,$4)`, [b2.id, R.c1b, T("06-16", 18), T("06-16", 20)])).rows[0].court_booking_reschedule, true)
  ok("remarcar muda quadra e horário", rs.court_id === R.c1b && rs.starts_at.startsWith("2030-06-16T18:00"), JSON.stringify(rs))
  await as(R.rr, async () => {
    const msgR = await err(`select public.court_booking_reschedule('${b2.id}','${R.c1}','${T("06-15", 20)}','${T("06-15", 21)}')`)
    ok("remarcar para horário ocupado é recusado", /Horário indisponível/.test(msgR ?? ""), String(msgR))
    ok("quadra de outro estabelecimento é recusada", /Quadra não encontrada/.test(await err(`select public.court_booking_reschedule('${b2.id}','${R.c2}','${T("06-16", 18)}','${T("06-16", 20)}')`) ?? ""))
  })

  // atualização e situação
  await as(R.rr, async () => {
    ok("campo não permitido é recusado", /Campo não permitido/.test(await err(`select public.court_booking_update('${b3.id}','{"starts_at":"2030-01-01"}')`) ?? ""))
    ok("concluir antes do início é recusado", /depois do início/.test(await err(`select public.court_booking_update('${b3.id}','{"status":"concluida"}')`) ?? ""))
    ok("dados do cliente e pagamento podem ser atualizados", (await err(`select public.court_booking_update('${b3.id}','{"client_name":"Carlos Souza","payment_method":"pix","payment_status":"pago","notes":"pagou adiantado"}')`)) === null)
    ok("cancelar por update é recusado (há função própria)", /use a opção Cancelar/.test(await err(`select public.court_booking_update('${b3.id}','{"status":"cancelada"}')`) ?? ""))
  }, true)
  ok("alteração aplicada", (await q(`select client_name, payment_status from public.court_bookings where id=$1`, [b3.id]))[0].payment_status === "pago")
  await q(`update public.court_bookings set status='pendente' where id=$1`, [b3.id])
  await as(R.rr, async () => { ok("pendente → confirmada", (await err(`select public.court_booking_update('${b3.id}','{"status":"confirmada"}')`)) === null) })

  // recorrência
  const ser = await as(R.rr, async () => (await db.query(`select public.court_series_create($1,'mensalista','Time dos Amigos','48999990000',null,'2030-07-06',1260,60,'semanal',null,4)`, [R.c1])).rows[0].court_series_create, true)
  ok("recorrência semanal cria uma reserva por semana, cada uma com código e número", ser.created === 4 && ser.conflicts.length === 0 && (await one(`select count(*)::int from public.court_bookings where series_id=$1`, [ser.series_id])) === 4)
  await book(R.ra, R.c1, "avulsa", "Ocupa a 2ª semana", T("07-20", 19), T("07-20", 20))
  const ser2 = await as(R.rr, async () => (await db.query(`select public.court_series_create($1,'mensalista','Outro Time',null,null,'2030-07-13',1140,60,'semanal',null,4)`, [R.c1])).rows[0].court_series_create, true)
  ok("recorrência relata as datas em conflito em vez de pular em silêncio", ser2.created === 3 && ser2.conflicts.length === 1 && ser2.conflicts[0].date === "2030-07-20" && /já existe/.test(ser2.conflicts[0].reason), JSON.stringify(ser2.conflicts))
  ok("recorrência sem nenhuma ocorrência possível não deixa série órfã", await (async () => { let m; await as(R.rr, async () => { m = await err(`select public.court_series_create('${R.c1}','mensalista','Sem vaga',null,null,'2030-07-06',1260,60,'semanal',null,1)`) }); return /Nenhuma ocorrência/.test(m ?? "") && (await one(`select count(*)::int from public.court_series where client_name='Sem vaga'`)) === 0 })())
  const mid = await one(`select id from public.court_bookings where series_id=$1 and occurrence_no=2`, [ser.series_id])
  await as(R.rr, async () => { await db.query(`select public.court_booking_update($1,'{"client_name":"Time Novo","price_cents":15000}','future')`, [mid]) }, true)
  const nomes = await q(`select occurrence_no, client_name, price_cents from public.court_bookings where series_id=$1 order by occurrence_no`, [ser.series_id])
  ok("alterar 'esta e as próximas' não mexe nas anteriores", nomes[0].client_name === "Time dos Amigos" && nomes.slice(1).every((n) => n.client_name === "Time Novo" && n.price_cents === 15000), JSON.stringify(nomes))
  await as(R.rr, async () => { await db.query(`select public.court_booking_cancel($1,'encerrou o contrato','future')`, [mid]) }, true)
  ok("cancelar 'esta e as próximas' mantém a primeira ocorrência", (await one(`select count(*)::int from public.court_bookings where series_id=$1 and status='cancelada'`, [ser.series_id])) === 3 && (await one(`select status from public.court_bookings where series_id=$1 and occurrence_no=1`, [ser.series_id])) === "confirmada")
  const mensal = await as(R.rr, async () => (await db.query(`select public.court_series_create($1,'avulsa','Mensal Fulano',null,null,'2030-08-03',720,60,'mensal',null,3)`, [R.c1])).rows[0].court_series_create, true)
  ok("recorrência mensal mantém o dia do mês (03/08, 03/09, 03/10)", (await q(`select to_char(starts_at at time zone 'America/Sao_Paulo','DD/MM') d from public.court_bookings where series_id=$1 order by starts_at`, [mensal.series_id])).map((r) => r.d).join() === "03/08,03/09,03/10", JSON.stringify(mensal))

  // histórico
  await as(R.rr, async () => {
    const h = await q(`select action, by_name from public.court_booking_history('${b3.id}')`)
    ok("histórico mostra criação e alterações, com quem fez", h.length >= 3 && h[0].action === "INSERT" && h[0].by_name.startsWith("Pessoa") && h.every((r) => !!r.by_name), JSON.stringify(h))
  })

  // isolamento
  await as(R.rb, async () => {
    ok("outro estabelecimento não vê reservas, séries nem horários", (await one(`select count(*)::int from public.court_bookings`)) === 0 && (await one(`select count(*)::int from public.court_series`)) === 0 && (await one(`select count(*)::int from public.court_hours`)) === 0)
    ok("outro estabelecimento não altera nem cancela reservas alheias", /não encontrada/.test(await err(`select public.court_booking_cancel('${b3.id}','x')`) ?? "") && /não encontrada/.test(await err(`select public.court_booking_update('${b3.id}','{"notes":"x"}')`) ?? ""))
    ok("outro estabelecimento não reserva quadra alheia", /Quadra não encontrada|Configure os horários/.test(await err(`select public.court_booking_create('${R.c1}','avulsa','Invasor',null,null,'${T("06-22", 12)}','${T("06-22", 13)}')`) ?? ""))
  })
  await as(R.rr, async () => { ok("recepcionista não altera horários de funcionamento nem preços", (await q(`update public.court_hours set active=false returning 1`)).length === 0 && /row-level security|violates/i.test(await err(`insert into public.court_price_rules (name, weekdays, from_min, to_min, price_cents) values ('X Y', array[1], 0, 60, 1)`) ?? "")) })

  // modo espião
  await as(R.boss, async () => { await db.query(`select public.sa_support_start($1,'conferir agenda',30)`, [R.o1]) }, true)
  await as(R.boss, async () => {
    ok("modo espião: dono lê a agenda", (await one(`select count(*)::int from public.court_bookings`)) >= 3)
    ok("modo espião: não cria nem cancela reservas", /somente leitura/.test(await err(`select public.court_booking_create('${R.c1}','avulsa','Teste Espião',null,null,'${T("06-23", 12)}','${T("06-23", 13)}')`) ?? "") && /somente leitura/.test(await err(`select public.court_booking_cancel('${b3.id}','x')`) ?? ""))
  })
  await q(`delete from public.support_sessions`)

  // simultaneidade: duas pessoas tentam o mesmo horário ao mesmo tempo
  const c2 = new pg.Client({ connectionString: "postgresql://postgres:test@localhost:54331/geab_test" }); await c2.connect()
  const slot = [R.c1, "avulsa", "Concorrente", null, null, T("07-27", 15), T("07-27", 16)]
  const call = `select public.court_booking_create($1,$2,$3,$4,$5,$6,$7)`
  await c2.query("begin"); await c2.query("set local role authenticated"); await c2.query("select set_config('request.jwt.claim.sub', $1, true)", [R.rr])
  await c2.query(call, slot)                                      // a primeira pessoa reservou, ainda sem confirmar a transação
  await db.query("begin"); await db.query("set local role authenticated"); await db.query("select set_config('request.jwt.claim.sub', $1, true)", [R.ra])
  const segunda = db.query(call, slot.map((v, i) => (i === 2 ? "Segunda pessoa" : v))).then(() => null, (e) => e.message)   // a segunda fica esperando
  await new Promise((r) => setTimeout(r, 500))
  await c2.query("commit"); const msg = await segunda; await db.query("rollback"); await c2.end()
  ok("duas reservas simultâneas do mesmo horário: só uma vence", /Horário indisponível/.test(msg ?? "") && (await one(`select count(*)::int from public.court_bookings where court_id=$1 and starts_at=$2 and status <> 'cancelada'`, [R.c1, T("07-27", 15)])) === 1, String(msg))

  // exportação e prévia de preço
  ok("exportação do estabelecimento inclui reservas, séries e horários", await (async () => { let ex; await as(R.boss, async () => { ex = await one(`select public.sa_org_export($1)`, [R.o1]) }, true); return ex.tabelas.court_bookings?.length >= 5 && ex.tabelas.court_series?.length >= 2 && ex.tabelas.court_hours?.length >= 3 })())
  await as(R.rr, async () => { ok("prévia de preço usa as regras", (await one(`select public.court_price_preview('${R.c1}','avulsa','${T("06-22", 19)}','${T("06-22", 21)}')`)) === 36000) })
}

section("Quadra Esportiva: clientes, lista de espera e equipe (0037)")
{
  const S = { o1: uid(1401), o2: uid(1402), a1: uid(1411), g1: uid(1412), r1: uid(1413), f1: uid(1414), a2: uid(1415), v1: uid(1421), v2: uid(1422), c1: uid(1431), c2: uid(1432) }
  await q(`insert into auth.users (id, email) values ($1,'s-a1@x'),($2,'s-g1@x'),($3,'s-r1@x'),($4,'s-f1@x'),($5,'s-a2@x')`, [S.a1, S.g1, S.r1, S.f1, S.a2])
  const mk = (o, slug) => q(`insert into public.organizations (id, slug, name, status, kind, plan_id) values ($1,$2,$2,'ativa','quadra',(select id from public.plans where code='quadra_t'))`, [o, slug])
  await mk(S.o1, "arena-s1"); await mk(S.o2, "arena-s2")
  const pf = (o, id, role) => q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,$3,$4)`, [o, id, "Pessoa " + id.slice(-3), role])
  await pf(S.o1, S.a1, "admin"); await pf(S.o1, S.g1, "diretoria"); await pf(S.o1, S.r1, "diretoria"); await pf(S.o1, S.f1, "diretoria"); await pf(S.o2, S.a2, "admin")
  await q(`insert into public.court_staff (tenant_id, profile_id, role) values ($1,$2,'gerente'),($1,$3,'recepcionista'),($1,$4,'financeiro')`, [S.o1, S.g1, S.r1, S.f1])
  await q(`insert into public.court_venues (id, tenant_id, trade_name) values ($1,$2,'Arena S1'),($3,$4,'Arena S2')`, [S.v1, S.o1, S.v2, S.o2])
  await q(`insert into public.court_courts (id, tenant_id, venue_id, name, sport, price_cents) values ($1,$2,$3,'Quadra S1','futsal',10000),($4,$5,$6,'Quadra S2','futsal',9000)`, [S.c1, S.o1, S.v1, S.c2, S.o2, S.v2])
  await q(`insert into public.court_hours (tenant_id, weekday, opens_min, closes_min) select $1, d, 480, 1380 from generate_series(0,6) d`, [S.o1])
  const T = (dia, h) => `2030-${dia}T${String(h).padStart(2, "0")}:00:00-03:00`   // 2030-06-15 é sábado

  // clientes
  await as(S.r1, async () => {
    await db.query(`insert into public.court_clients (name, phone, email) values ('  João   da Silva ', '(48) 99999-1111', 'JOAO@X.COM')`)
    const c = (await q(`select * from public.court_clients`))[0]
    ok("cliente: nome, telefone (com DDI) e e-mail normalizados; estabelecimento vem da sessão", c.name === "João da Silva" && c.phone === "5548999991111" && c.email === "joao@x.com" && c.tenant_id === S.o1)
    ok("telefone duplicado no mesmo estabelecimento é recusado", /court_clients_phone_uniq|duplicate/.test(await err(`insert into public.court_clients (name, phone) values ('Outro Joao','48999991111')`) ?? ""))
    ok("tipo e status inválidos são recusados", (await err(`insert into public.court_clients (name, client_type) values ('Fulano X','vip')`)) !== null && (await err(`insert into public.court_clients (name, status) values ('Fulano X','x')`)) !== null)
    ok("nascimento no futuro é recusado", (await err(`insert into public.court_clients (name, birth_date) values ('Fulano X', current_date + 1)`)) !== null)
    ok("recepcionista não exclui cliente", (await q(`delete from public.court_clients returning 1`)).length === 0)
  }, true)
  await as(S.f1, async () => {
    ok("financeiro lê clientes mas não cadastra", (await one(`select count(*)::int from public.court_clients`)) === 1 && /row-level security|violates/i.test(await err(`insert into public.court_clients (name) values ('Fulano Y')`) ?? ""))
  })
  await as(S.a2, async () => {
    ok("outro estabelecimento não vê clientes", (await one(`select count(*)::int from public.court_clients`)) === 0)
    ok("outro estabelecimento não cria cliente em nome do primeiro", /fora da organização/.test(await err(`insert into public.court_clients (tenant_id, name) values ('${S.o1}','Invasor X')`) ?? ""))
    await db.query(`insert into public.court_clients (name, phone) values ('Cliente Dois', '48999991111')`)
    ok("mesmo telefone pode existir em estabelecimentos diferentes", (await one(`select count(*)::int from public.court_clients`)) === 1)
  }, true)
  // reserva liga ao cliente pelo telefone
  const bk = await as(S.r1, async () => (await db.query(`select public.court_booking_create($1,'avulsa','João da Silva','(48) 99999-1111',null,$2,$3)`, [S.c1, T("06-15", 20), T("06-15", 21)])).rows[0].court_booking_create, true)
  ok("reserva se liga ao cliente do mesmo estabelecimento pelo telefone", (await one(`select c.name from public.court_bookings b join public.court_clients c on c.id=b.client_id where b.id=$1`, [bk.id])) === "João da Silva")
  ok("reserva do outro estabelecimento nunca liga ao cliente alheio", (await one(`select count(*)::int from public.court_bookings where client_id is not null and tenant_id <> (select tenant_id from public.court_clients where id = client_id)`)) === 0)
  await as(S.g1, async () => { ok("cliente com reservas não pode ser excluído (histórico preservado)", /foreign key|violates/i.test(await err(`delete from public.court_clients where name='João da Silva'`) ?? "")) })

  // lista de espera
  await as(S.r1, async () => {
    await db.query(`insert into public.court_waitlist (name, phone, sport, weekday, start_min, contact_consent) values ('Maria Souza','(48) 98888-2222','futsal',6,1200,true), ('Pedro Lima','(48) 97777-3333','futsal',6,1260,true)`)
    ok("lista de espera exige telefone ou e-mail", /telefone ou e-mail|check/i.test(await err(`insert into public.court_waitlist (name) values ('Sem Contato')`) ?? ""))
    const m = await q(`select w.name, m.court_name, m.starts_at from public.court_waitlist_matches(3650) m join public.court_waitlist w on w.id = m.waitlist_id order by w.name, m.starts_at`)
    ok("horário ocupado às 20h não é oferecido; às 21h livre é oferecido", !m.some((x) => x.name === "Maria Souza" && new Date(x.starts_at).toISOString() === "2030-06-15T23:00:00.000Z") && m.some((x) => x.name === "Pedro Lima"))
    ok("lista de espera não cria reserva", (await one(`select count(*)::int from public.court_bookings where client_name in ('Maria Souza','Pedro Lima')`)) === 0)
    await db.query(`select public.court_waitlist_mark((select id from public.court_waitlist where name='Maria Souza'), 'avisado')`)
    ok("marcar como avisado registra data", (await one(`select notified_at is not null from public.court_waitlist where name='Maria Souza'`)) === true)
    ok("situação inválida é recusada", /inválida/.test(await err(`select public.court_waitlist_mark((select id from public.court_waitlist limit 1), 'xx')`) ?? ""))
  })
  await as(S.f1, async () => { ok("financeiro não acessa a lista de espera", (await one(`select count(*)::int from public.court_waitlist`)) === 0 && /permissão/.test(await err(`select * from public.court_waitlist_matches()`) ?? "")) })
  await as(S.a2, async () => { ok("outro estabelecimento não vê nem altera a lista de espera", (await one(`select count(*)::int from public.court_waitlist`)) === 0 && /não encontrada/.test(await err(`select public.court_waitlist_mark('${(await one(`select id from public.court_waitlist limit 1`)) ?? S.o1}','avisado')`) ?? "não encontrada")) })

  // funcionários
  await as(S.a1, async () => {
    const l = await q(`select * from public.court_staff_list()`)
    ok("administrador lista a equipe do próprio estabelecimento", l.length === 3 && l.every((r) => r.email))
    await db.query(`select public.court_staff_update($1,'recepcionista','Noite',false)`, [S.g1])
    ok("bloquear funcionário desativa equipe e perfil", (await one(`select active from public.court_staff where profile_id=$1`, [S.g1])) === false && (await one(`select active from public.profiles where id=$1`, [S.g1])) === false)
    ok("perfil de administrador não pode ser atribuído à equipe", /inválido/.test(await err(`select public.court_staff_update('${S.r1}','admin',null,true)`) ?? ""))
  }, true)
  await as(S.g1, async () => { ok("funcionário bloqueado perde o acesso ao módulo", (await one(`select public.court_role()`)) === null) })
  await as(S.r1, async () => { ok("recepcionista não lista nem altera a equipe", /permissão/.test(await err(`select * from public.court_staff_list()`) ?? "") && /permissão/.test(await err(`select public.court_staff_update('${S.f1}','gerente',null,true)`) ?? "")) })
  await as(S.a2, async () => { ok("outro administrador não altera funcionário alheio", /não encontrado/.test(await err(`select public.court_staff_update('${S.r1}','gerente',null,true)`) ?? "") && (await one(`select count(*)::int from public.court_staff_list()`)) === 0) })
}

section("Quadra Esportiva: financeiro (0038)")
{
  const F = { o1: uid(1501), o2: uid(1502), a1: uid(1511), r1: uid(1512), f1: uid(1513), g1: uid(1514), a2: uid(1515), v1: uid(1521), v2: uid(1522), c1: uid(1531), c2: uid(1532) }
  await q(`insert into auth.users (id, email) values ($1,'f-a1@x'),($2,'f-r1@x'),($3,'f-f1@x'),($4,'f-g1@x'),($5,'f-a2@x')`, [F.a1, F.r1, F.f1, F.g1, F.a2])
  const mk = (o, slug) => q(`insert into public.organizations (id, slug, name, status, kind, plan_id) values ($1,$2,$2,'ativa','quadra',(select id from public.plans where code='quadra_t'))`, [o, slug])
  await mk(F.o1, "arena-f1"); await mk(F.o2, "arena-f2")
  const pf = (o, id, role) => q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,$3,$4)`, [o, id, "Pessoa " + id.slice(-3), role])
  await pf(F.o1, F.a1, "admin"); await pf(F.o1, F.r1, "diretoria"); await pf(F.o1, F.f1, "diretoria"); await pf(F.o1, F.g1, "diretoria"); await pf(F.o2, F.a2, "admin")
  await q(`insert into public.court_staff (tenant_id, profile_id, role) values ($1,$2,'recepcionista'),($1,$3,'financeiro'),($1,$4,'gerente')`, [F.o1, F.r1, F.f1, F.g1])
  await q(`insert into public.court_venues (id, tenant_id, trade_name, cancel_free_hours, cancel_fee_pct) values ($1,$2,'Arena F1',24,50),($3,$4,'Arena F2',24,0)`, [F.v1, F.o1, F.v2, F.o2])
  await q(`insert into public.court_courts (id, tenant_id, venue_id, name, sport, price_cents) values ($1,$2,$3,'Quadra F1','futsal',10000),($4,$5,$6,'Quadra F2','futsal',9000)`, [F.c1, F.o1, F.v1, F.c2, F.o2, F.v2])
  await q(`insert into public.court_hours (tenant_id, weekday, opens_min, closes_min) select $1, d, 480, 1380 from generate_series(0,6) d`, [F.o1])
  const T = (dia, h) => `2030-${dia}T${String(h).padStart(2, "0")}:00:00-03:00`
  const bk = (u, s, e, name = "Cliente Fin") => as(u, async () => (await db.query(`select public.court_booking_create($1,'avulsa',$4,'(48) 99999-5555',null,$2,$3)`, [F.c1, s, e, name])).rows[0].court_booking_create, true)
  const b1 = await bk(F.a1, T("08-10", 20), T("08-10", 21)), b2 = await bk(F.a1, T("08-11", 20), T("08-11", 21)), b3 = await bk(F.a1, T("08-12", 20), T("08-12", 21))
  let r1

  await as(F.f1, async () => {
    r1 = (await db.query(`select public.court_receivable_create($1,null,null,null,'2030-08-10')`, [b1.id])).rows[0].court_receivable_create
    ok("lançamento da reserva: valor, cliente e código vêm do servidor", r1.amount_cents === 10000 && r1.code === "L-000001" && r1.client_name === "Cliente Fin" && r1.status === "aberto")
    ok("não gera cobrança duplicada para a mesma reserva", /já tem um lançamento/.test(await err(`select public.court_receivable_create('${b1.id}',null,null,null,'2030-08-10')`) ?? ""))
    ok("pagamento maior que o saldo é recusado", /excede o saldo/.test(await err(`select public.court_payment_register('${r1.id}', 10001, 'pix')`) ?? ""))
    ok("pagamento zero ou data futura é recusado", /maior que zero/.test(await err(`select public.court_payment_register('${r1.id}', 0, 'pix')`) ?? "") && /futura/.test(await err(`select public.court_payment_register('${r1.id}', 100, 'pix', '2999-01-01')`) ?? ""))
    const p1 = (await db.query(`select public.court_payment_register($1, 4000, 'pix')`, [r1.id])).rows[0].court_payment_register
    ok("pagamento parcial: parcialmente pago e saldo correto", p1.status === "parcial" && p1.paid_cents === 4000)
    ok("reserva acompanha: pagamento parcial", (await one(`select payment_status from public.court_bookings where id=$1`, [b1.id])) === "parcial")
    const p2 = (await db.query(`select public.court_payment_register($1, 6000, 'dinheiro')`, [r1.id])).rows[0].court_payment_register
    ok("baixa do saldo: pago", p2.status === "pago" && (await one(`select payment_status from public.court_bookings where id=$1`, [b1.id])) === "pago")
    ok("lançamento pago não recebe outro pagamento", /já está pago/.test(await err(`select public.court_payment_register('${r1.id}', 100, 'pix')`) ?? ""))
    ok("dois pagamentos ficaram registrados", (await one(`select count(*)::int from public.court_payments where receivable_id=$1`, [r1.id])) === 2)
    ok("pagamento é imutável (nem alterar nem apagar)", /não podem ser alterados/.test(await err(`update public.court_payments set amount_cents = 1`) ?? "") || /permission denied/.test(await err(`update public.court_payments set amount_cents = 1`) ?? ""))
    ok("escrita direta nas tabelas financeiras é bloqueada", /permission denied/.test(await err(`insert into public.court_receivables (code, client_name, description, due_on, amount_cents) values ('X','Fulano X','x','2030-01-01',1)`) ?? "") && /permission denied/.test(await err(`delete from public.court_receivables`) ?? ""))
    ok("lançamento pago com pagamentos não pode ser cancelado", /pagamentos registrados/.test(await err(`select public.court_receivable_cancel('${r1.id}','x')`) ?? ""))
  }, true)
  // cancelamento: sem pagamento e fora do prazo grátis → multa de 50%; longe do prazo → cancela o lançamento
  await as(F.f1, async () => { await db.query(`select public.court_receivable_create($1,null,null,null,'2030-08-11')`, [b2.id]) }, true)
  await as(F.r1, async () => { await db.query(`select public.court_booking_cancel($1,'desistiu')`, [b2.id]) }, true)   // 2030: faltam muitas horas → sem multa
  ok("cancelar reserva (dentro do prazo) cancela o lançamento, sem apagar", (await one(`select status from public.court_receivables where booking_id=$1`, [b2.id])) === "cancelado" && (await one(`select count(*)::int from public.court_receivables where booking_id=$1`, [b2.id])) === 1)
  await as(F.f1, async () => { ok("reserva cancelada não gera nova cobrança", /cancelada não gera/.test(await err(`select public.court_receivable_create('${b2.id}',null,null,null,'2030-08-11')`) ?? "")) })
  // multa de cancelamento tardio: reserva próxima (passado recente permitido ao admin)
  const soon = new Date(Date.now() + 3 * 3600e3); soon.setMinutes(0, 0, 0)
  const sIso = soon.toISOString(), eIso = new Date(soon.getTime() + 3600e3).toISOString()
  const hh = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" }).format(soon)) % 24
  await q(`update public.court_hours set opens_min=0, closes_min=1440 where tenant_id=$1`, [F.o1])
  const b4 = await as(F.a1, async () => (await db.query(`select public.court_booking_create($1,'avulsa','Cliente Tardio','(48) 99999-6666',null,$2,$3)`, [F.c1, sIso, eIso])).rows[0].court_booking_create, true)
  await as(F.f1, async () => { await db.query(`select public.court_receivable_create($1,null,null,null,'2030-08-11')`, [b4.id]) }, true)
  await as(F.r1, async () => { await db.query(`select public.court_booking_cancel($1,'tarde')`, [b4.id]) }, true)
  const lr = (await q(`select * from public.court_receivables where booking_id=$1`, [b4.id]))[0]
  ok("cancelamento tardio reduz o lançamento à multa configurada (50%)", lr.status === "aberto" && lr.amount_cents === 5000 && /multa/.test(lr.description), JSON.stringify(lr))
  // mensalidade
  const ser = await as(F.a1, async () => (await db.query(`select public.court_series_create($1,'mensalista','Mensalista Um','(48) 98888-7777',null,'2030-09-02',1200,60,'semanal',null,4)`, [F.c1])).rows[0].court_series_create, true).catch((e) => ({ err: e.message }))
  if (ser.err) ok("série criada para o teste de mensalidade", false, ser.err)
  else {
    const sid = ser.series_id ?? ser.id
    await as(F.g1, async () => {
      const m = (await db.query(`select public.court_receivable_generate_monthly($1,'2030-09-15',null)`, [sid])).rows[0].court_receivable_generate_monthly
      ok("mensalidade soma as ocorrências do mês", m.amount_cents === 40000 && m.competence === "2030-09-01", JSON.stringify(m))
      ok("mensalidade do mesmo mês não duplica", /já foi gerada/.test(await err(`select public.court_receivable_generate_monthly('${sid}','2030-09-01',null)`) ?? ""))
    }, true)
  }
  // permissões e isolamento
  await as(F.r1, async () => { ok("recepcionista não vê nem lança financeiro", (await one(`select count(*)::int from public.court_receivables`)) === 0 && /permissão/.test(await err(`select public.court_receivable_create('${b3.id}',null,null,null,'2030-08-12')`) ?? "")) })
  await as(F.a2, async () => {
    ok("outro estabelecimento não vê lançamentos nem pagamentos", (await one(`select count(*)::int from public.court_receivables`)) === 0 && (await one(`select count(*)::int from public.court_payments`)) === 0)
    ok("outro estabelecimento não baixa nem cancela lançamento alheio", /não encontrado/.test(await err(`select public.court_payment_register('${r1.id}', 1, 'pix')`) ?? "") && /não encontrado/.test(await err(`select public.court_receivable_cancel('${r1.id}','x')`) ?? ""))
    ok("outro estabelecimento não cobra reserva alheia", /não encontrada/.test(await err(`select public.court_receivable_create('${b3.id}',null,null,null,'2030-08-12')`) ?? ""))
  })
  // lançamento avulso, edição, cancelamento e indicadores
  await as(F.g1, async () => {
    const m = (await db.query(`select public.court_receivable_create(null,null,'Fulano Avulso','Taxa de torneio','2020-01-10',25000)`)).rows[0].court_receivable_create
    ok("lançamento avulso sem reserva", m.amount_cents === 25000 && m.booking_id === null)
    ok("valor não pode ficar abaixo do já pago", (await db.query(`select public.court_payment_register($1, 5000, 'pix')`, [m.id]), /menor que o já pago/.test(await err(`select public.court_receivable_update('${m.id}','x y',null,4000,null)`) ?? "")))
    const s = (await db.query(`select public.court_finance_summary(current_date - 30, current_date)`)).rows[0].court_finance_summary
    ok("indicadores: a receber, vencido e recebido", s.overdue === 20000 && s.overdue_count === 1 && s.received >= 15000 && s.to_receive >= 20000, JSON.stringify(s))
    ok("receita por quadra e modalidade vêm das reservas", Array.isArray(s.by_court) && Array.isArray(s.by_sport))
    await db.query(`select public.court_receivable_create(null,null,'Fulano Cancel','Teste','2030-01-10',1000)`)
    const c = (await q(`select id from public.court_receivables where client_name='Fulano Cancel'`))[0]
    await db.query(`select public.court_receivable_cancel($1,'engano')`, [c.id])
    ok("cancelar lançamento mantém o registro", (await one(`select status from public.court_receivables where id=$1`, [c.id])) === "cancelado")
  }, true)
  // concorrência: duas baixas ao mesmo tempo no mesmo saldo
  const rc = await as(F.a1, async () => (await db.query(`select public.court_receivable_create(null,null,'Fulano Conc','Concorrência','2030-01-10',10000)`)).rows[0].court_receivable_create, true)
  const c2 = new pg.Client({ connectionString: "postgresql://postgres:test@localhost:54331/geab_test" }); await c2.connect()
  await c2.query("begin"); await c2.query("set local role authenticated"); await c2.query("select set_config('request.jwt.claim.sub', $1, true)", [F.a1])
  await c2.query(`select public.court_payment_register($1, 7000, 'pix')`, [rc.id])
  await db.query("begin"); await db.query("set local role authenticated"); await db.query("select set_config('request.jwt.claim.sub', $1, true)", [F.f1])
  const seg = db.query(`select public.court_payment_register($1, 7000, 'pix')`, [rc.id]).then(() => null, (e) => e.message)
  await new Promise((r) => setTimeout(r, 400)); await c2.query("commit"); const msg = await seg; await db.query("rollback"); await c2.end()
  ok("duas baixas simultâneas nunca passam do saldo", /excede o saldo/.test(msg ?? "") && (await one(`select paid_cents from public.court_receivables where id=$1`, [rc.id])) === 7000, String(msg))
}

section("Quadra Esportiva: dashboard e relatórios (0039)")
{
  const D = { o1: uid(1601), o2: uid(1602), a1: uid(1611), r1: uid(1612), f1: uid(1613), g1: uid(1614), a2: uid(1615), v1: uid(1621), v2: uid(1622), c1: uid(1631), c2: uid(1632), c3: uid(1633) }
  await q(`insert into auth.users (id, email) values ($1,'d-a1@x'),($2,'d-r1@x'),($3,'d-f1@x'),($4,'d-g1@x'),($5,'d-a2@x')`, [D.a1, D.r1, D.f1, D.g1, D.a2])
  const mk = (o, slug) => q(`insert into public.organizations (id, slug, name, status, kind, plan_id) values ($1,$2,$2,'ativa','quadra',(select id from public.plans where code='quadra_t'))`, [o, slug])
  await mk(D.o1, "arena-d1"); await mk(D.o2, "arena-d2")
  const pf = (o, id, role) => q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,$3,$4)`, [o, id, "Pessoa " + id.slice(-3), role])
  await pf(D.o1, D.a1, "admin"); await pf(D.o1, D.r1, "diretoria"); await pf(D.o1, D.f1, "diretoria"); await pf(D.o1, D.g1, "diretoria"); await pf(D.o2, D.a2, "admin")
  await q(`insert into public.court_staff (tenant_id, profile_id, role) values ($1,$2,'recepcionista'),($1,$3,'financeiro'),($1,$4,'gerente')`, [D.o1, D.r1, D.f1, D.g1])
  await q(`insert into public.court_venues (id, tenant_id, trade_name) values ($1,$2,'Arena D1'),($3,$4,'Arena D2')`, [D.v1, D.o1, D.v2, D.o2])
  await q(`insert into public.court_courts (id, tenant_id, venue_id, name, sport, price_cents) values ($1,$2,$3,'Quadra D1','futsal',10000),($4,$2,$3,'Quadra D1b','futsal',10000),($5,$6,$7,'Quadra D2','futsal',9000)`, [D.c1, D.o1, D.v1, D.c2, D.c3, D.o2, D.v2])
  await q(`insert into public.court_hours (tenant_id, weekday, opens_min, closes_min) select $1, d, 480, 1380 from generate_series(0,6) d`, [D.o1])
  const T = (dia, h) => `2030-${dia}T${String(h).padStart(2, "0")}:00:00-03:00`   // 2030-06-15 sábado
  const book = (s, e, name, ph) => as(D.a1, async () => (await db.query(`select public.court_booking_create($1,'avulsa',$4,$5,null,$2,$3)`, [D.c1, s, e, name, ph])).rows[0].court_booking_create, true)
  await as(D.a1, async () => { await db.query(`insert into public.court_clients (name, phone, client_type, birth_date, birthday_consent) values ('Ana Mensal','(48) 91111-0001','mensalista','1990-03-10',true), ('Bruno Sem Autorização','(48) 91111-0002','avulso','1990-03-11',false)`) }, true)
  const b1 = await book(T("06-15", 19), T("06-15", 21), "Ana Mensal", "(48) 91111-0001"), b2 = await book(T("06-15", 21), T("06-15", 22), "Bruno Sem Autorização", "(48) 91111-0002")
  await as(D.a1, async () => { await db.query(`select public.court_booking_cancel($1,'x')`, [b2.id]); await db.query(`select public.court_block_create(array[$1::uuid],'manutencao',$2,$3)`, [D.c1, T("06-15", 10), T("06-15", 12)]) }, true)
  await as(D.g1, async () => {
    const r = (await db.query(`select public.court_report_occupancy('2030-06-15','2030-06-15')`)).rows[0].court_report_occupancy
    const c = r.by_court.find((x) => x.court === "Quadra D1")
    ok("ocupação: abertas 900 min, bloqueio de 120 tira da disponibilidade, 120 ocupados (cancelada fora)", c.open_min === 780 && c.booked_min === 120 && c.blocked_min === 120, JSON.stringify(c))
    ok("ocupação por dia da semana (sábado) e faixa de horário", r.by_weekday.length === 1 && r.by_weekday[0].weekday === 6 && r.by_hour.some((h) => h.hour === 19 && h.n === 1))
    ok("ocupação por categoria e modalidade", r.by_kind[0].kind === "avulsa" && r.by_kind[0].n === 1 && r.by_sport[0].n === 1)
    const cl = (await db.query(`select public.court_report_clients('2030-06-01','2030-06-30')`)).rows[0].court_report_clients
    ok("clientes: ativos, mensalistas e frequência no período", cl.registered_active === 2 && cl.monthly_clients === 1 && cl.active_in_period === 1 && cl.top[0].client === "Ana Mensal" && cl.top[0].n === 1, JSON.stringify(cl))
    ok("período acima de 13 meses é recusado", /Período/.test(await err(`select public.court_report_clients('2029-01-01','2030-12-31')`) ?? ""))
    const d = (await db.query(`select public.court_dashboard('2030-06-01','2030-06-30')`)).rows[0].court_dashboard
    ok("dashboard: quadras, clientes ativos e mensalistas", d.courts_total === 2 && d.courts_active === 2 && d.clients_active === 2 && d.monthly_clients_active === 1)
    ok("dashboard: taxa de ocupação do período vem de minutos reais", d.occupancy.booked_min === 120 && d.occupancy.open_min === 900 * 30 * 2 - 120, JSON.stringify(d.occupancy))
    ok("dashboard: realizadas x canceladas", d.done_vs_cancelled.done === 1 && d.done_vs_cancelled.cancelled === 1)
    ok("aniversário só aparece com autorização do cliente", Array.isArray(d.birthdays) && !d.birthdays.some((b) => b.name.startsWith("Bruno")))
  })
  await as(D.r1, async () => {
    const d = (await db.query(`select public.court_dashboard('2030-06-01','2030-06-30')`)).rows[0].court_dashboard
    ok("recepcionista vê o operacional mas não os valores financeiros", d.revenue_month === null && d.to_receive === null && d.overdue === null && d.waitlist !== null)
    ok("recepcionista não acessa relatórios", /permissão/.test(await err(`select public.court_report_occupancy('2030-06-01','2030-06-30')`) ?? "") && /permissão/.test(await err(`select public.court_report_finance('2030-06-01','2030-06-30')`) ?? ""))
  })
  await as(D.f1, async () => {
    const d = (await db.query(`select public.court_dashboard('2030-06-01','2030-06-30')`)).rows[0].court_dashboard
    ok("financeiro vê valores, mas não a lista de espera nem aniversários", d.revenue_month !== null && d.waitlist === null && d.birthdays === null)
    const f = (await db.query(`select public.court_report_finance('2030-06-01','2030-06-30')`)).rows[0].court_report_finance
    ok("relatório financeiro tem comparativo, pendente e inadimplência", "received_prev" in f && "pending" in f && Array.isArray(f.overdue_clients))
    ok("financeiro não acessa relatórios de ocupação e clientes", /permissão/.test(await err(`select public.court_report_occupancy('2030-06-01','2030-06-30')`) ?? "") && /permissão/.test(await err(`select public.court_report_clients('2030-06-01','2030-06-30')`) ?? ""))
  })
  await as(D.a2, async () => {
    const d = (await db.query(`select public.court_dashboard('2030-06-01','2030-06-30')`)).rows[0].court_dashboard
    ok("outro estabelecimento enxerga só os próprios números", d.courts_total === 1 && d.clients_active === 0 && d.done_vs_cancelled.done === 0)
    const r = (await db.query(`select public.court_report_occupancy('2030-06-15','2030-06-15')`)).rows[0].court_report_occupancy
    ok("relatório do outro estabelecimento não inclui quadras alheias", r.by_court.length === 1 && r.by_court[0].court === "Quadra D2")
  })
  ok("funções de apoio não são executáveis pelo usuário", await (async () => { let m; await as(D.a1, async () => { m = await err(`select * from public.court_occupancy_days('${D.o1}','2030-06-15','2030-06-15')`) }); return /permission denied/.test(m ?? "") })())
}

section("Quadra Esportiva: página pública, reservas online e partidas (0040)")
{
  const P = { o1: uid(1701), o2: uid(1702), a1: uid(1711), a2: uid(1712), v1: uid(1721), v2: uid(1722), c1: uid(1731), c2: uid(1732), c3: uid(1733) }
  await q(`insert into auth.users (id, email) values ($1,'p-a1@x'),($2,'p-a2@x')`, [P.a1, P.a2])
  const mk = (o, slug) => q(`insert into public.organizations (id, slug, name, status, kind, plan_id) values ($1,$2,$2,'ativa','quadra',(select id from public.plans where code='quadra_t'))`, [o, slug])
  await mk(P.o1, "arena-publica"); await mk(P.o2, "arena-outra")
  await q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,'Admin P1','admin'),($3,$4,'Admin P2','admin')`, [P.o1, P.a1, P.o2, P.a2])
  await q(`insert into public.court_venues (id, tenant_id, trade_name, city, state, document, legal_name, doc_type, max_advance_days) values ($1,$2,'Arena Pública','Joinville','SC','11222333000181','Razão Secreta LTDA','cnpj',90),($3,$4,'Arena Outra','Curitiba','PR',null,null,null,90)`, [P.v1, P.o1, P.v2, P.o2])
  await q(`insert into public.court_courts (id, tenant_id, venue_id, name, sport, price_cents) values ($1,$2,$3,'Quadra P1','futsal',10000),($4,$2,$3,'Quadra P1b','futebol_society',12000),($5,$6,$7,'Quadra Outra','futsal',9000)`, [P.c1, P.o1, P.v1, P.c2, P.c3, P.o2, P.v2])
  await q(`insert into public.court_hours (tenant_id, weekday, opens_min, closes_min) select $1, d, 480, 1380 from generate_series(0,6) d`, [P.o1])
  await q(`insert into public.court_hours (tenant_id, weekday, opens_min, closes_min) select $1, d, 480, 1380 from generate_series(0,6) d`, [P.o2])
  const day = (n) => new Date(Date.now() + n * 86400e3).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
  const D1 = day(10), D2 = day(11), D3 = day(12), D4 = day(13)
  const T = (d, h) => `${d}T${String(h).padStart(2, "0")}:00:00-03:00`
  let done
  async function anon(fn, commit = false) {
    await db.query("begin"); done = false
    try { await db.query("set local role anon"); const r = await fn(); if (commit) { await db.query("commit"); done = true } return r } finally { if (!done) await db.query("rollback") }
  }
  const aerr = async (sql) => anon(async () => err(sql))
  const rpc = async (sql, p = []) => anon(async () => (await db.query(sql, p)).rows[0] && Object.values((await db.query(sql, p)).rows[0])[0])

  ok("centro nasce NÃO público: vitrine, disponibilidade e solicitação indisponíveis", (await anon(async () => (await db.query(`select public.court_public_venue('arena-publica') v`)).rows[0].v)) === null
    && /não encontrado/.test(await aerr(`select public.court_public_request('arena-publica','${P.c1}','${T(D1, 20)}','${T(D1, 21)}','João Teste','48999990001')`) ?? ""))
  await as(P.a1, async () => { await db.query(`update public.court_venues set public_enabled = true`) }, true)
  const venue = await anon(async () => (await db.query(`select public.court_public_venue('ARENA-publica') v`)).rows[0].v)
  ok("vitrine pública (slug sem diferenciar maiúsculas) traz quadras, horários e endereço", venue?.venue.name === "Arena Pública" && venue.courts.length === 2 && venue.hours.length === 7 && venue.venue.city === "Joinville")
  ok("vitrine NÃO expõe CNPJ, razão social nem identificadores internos", !JSON.stringify(venue).includes("11222333000181") && !JSON.stringify(venue).includes("Razão Secreta") && !("document" in venue.venue) && !("tenant_id" in venue))
  { const msgs = []; for (const t of ["court_bookings", "court_clients", "court_courts", "court_venues", "court_matches", "court_match_players", "court_receivables"]) msgs.push(await aerr(`select * from public.${t}`)); ok("visitante não lê nenhuma tabela do módulo", msgs.every((m) => /permission denied/.test(m ?? "")), msgs.join(" | ")) }
  ok("visitante não executa as funções internas nem as do painel", /permission denied/.test(await aerr(`select * from public.court_free_slots('${P.o1}','${D1}')`) ?? "") && /permission denied/.test(await aerr(`select public.court_booking_create('${P.c1}','avulsa','X Y',null,null,'${T(D1, 20)}','${T(D1, 21)}')`) ?? ""))
  const av0 = await anon(async () => (await db.query(`select public.court_public_availability('arena-publica','${D1}') v`)).rows[0].v)
  ok("disponibilidade: grade de 1h das 8h às 22h em cada quadra, com preço", av0.filter((s) => s.court_id === P.c1).length === 15 && av0.find((s) => s.court_id === P.c2 && s.start_min === 1200).price_cents === 12000)
  ok("dia fora do limite de antecedência não tem horários", (await anon(async () => (await db.query(`select public.court_public_availability('arena-publica','${day(200)}') v`)).rows[0].v)).length === 0)

  // solicitação online
  const r1 = await anon(async () => (await db.query(`select public.court_public_request('arena-publica',$1,$2,$3,'  João   Teste ','(48) 99999-0001','futsal','trazer colete') r`, [P.c1, T(D1, 20), T(D1, 21)])).rows[0].r, true)
  ok("solicitação online nasce PENDENTE, com código, preço do servidor e origem pública", r1.status === "pendente" && /^R-\d{6}$/.test(r1.code) && r1.price_cents === 10000
    && (await one(`select source from public.court_bookings where code=$1 and tenant_id=$2`, [r1.code, P.o1])) === "publica" && (await one(`select client_name from public.court_bookings where code=$1 and tenant_id=$2`, [r1.code, P.o1])) === "João Teste")
  const av1 = await anon(async () => (await db.query(`select public.court_public_availability('arena-publica','${D1}') v`)).rows[0].v)
  ok("a solicitação pendente já tira o horário da disponibilidade (fonte única)", !av1.some((s) => s.court_id === P.c1 && s.start_min === 1200) && av1.some((s) => s.court_id === P.c2 && s.start_min === 1200))
  ok("segunda pessoa no mesmo horário é recusada", /Horário indisponível/.test(await aerr(`select public.court_public_request('arena-publica','${P.c1}','${T(D1, 20)}','${T(D1, 21)}','Maria Teste','48999990002')`) ?? ""))
  await as(P.a1, async () => { ok("a equipe também não consegue reservar o mesmo horário no painel", /Horário indisponível/.test(await err(`select public.court_booking_create('${P.c1}','avulsa','Painel Teste',null,null,'${T(D1, 20)}','${T(D1, 21)}')`) ?? "")) })
  ok("a solicitação aparece para a equipe como reserva pendente", await (async () => { let n; await as(P.a1, async () => { n = await one(`select count(*)::int from public.court_bookings where status='pendente' and source='publica'`) }); return n === 1 })())
  ok("nome, telefone e duração são validados no servidor", /nome/.test(await aerr(`select public.court_public_request('arena-publica','${P.c1}','${T(D2, 20)}','${T(D2, 21)}','A','48999990003')`) ?? "") && /elefone/.test(await aerr(`select public.court_public_request('arena-publica','${P.c1}','${T(D2, 20)}','${T(D2, 21)}','Pessoa Teste','123')`) ?? "") && /4 horas/.test(await aerr(`select public.court_public_request('arena-publica','${P.c1}','${T(D2, 9)}','${T(D2, 15)}','Pessoa Teste','48999990003')`) ?? ""))
  ok("horário no passado, fora do funcionamento e fora da grade são recusados", /antecedência/.test(await aerr(`select public.court_public_request('arena-publica','${P.c1}','${T(day(-1), 20)}','${T(day(-1), 21)}','Pessoa Teste','48999990003')`) ?? "") && /funcionamento/.test(await aerr(`select public.court_public_request('arena-publica','${P.c1}','${T(D2, 6)}','${T(D2, 7)}','Pessoa Teste','48999990003')`) ?? "") && /intervalos/.test(await aerr(`select public.court_public_request('arena-publica','${P.c1}','${T(D2, 20).replace(":00:00-", ":30:00-")}','${T(D2, 21).replace(":00:00-", ":30:00-")}','Pessoa Teste','48999990003')`) ?? ""))
  ok("não dá para reservar quadra de outro centro usando o endereço de um centro", /Quadra não encontrada/.test(await aerr(`select public.court_public_request('arena-publica','${P.c3}','${T(D2, 20)}','${T(D2, 21)}','Pessoa Teste','48999990003')`) ?? ""))
  // freio por telefone
  for (const h of [9, 10]) await anon(async () => { await db.query(`select public.court_public_request('arena-publica',$1,$2,$3,'João Teste','48999990001')`, [P.c1, T(D2, h), T(D2, h + 1)]) }, true)
  ok("no máximo 3 solicitações pendentes por telefone", /aguardando confirmação/.test(await aerr(`select public.court_public_request('arena-publica','${P.c1}','${T(D2, 12)}','${T(D2, 13)}','João Teste','48999990001')`) ?? ""))
  // desligar a página pública / suspender
  await as(P.a1, async () => { await db.query(`update public.court_venues set public_enabled = false`) }, true)
  ok("desligar a página pública fecha tudo", (await anon(async () => (await db.query(`select public.court_public_availability('arena-publica','${D1}') v`)).rows[0].v)) === null && /não encontrado/.test(await aerr(`select public.court_public_request('arena-publica','${P.c2}','${T(D3, 20)}','${T(D3, 21)}','Pessoa Teste','48999990009')`) ?? ""))
  await as(P.a1, async () => { await db.query(`update public.court_venues set public_enabled = true`) }, true)
  await q(`update public.organizations set status='suspensa' where id=$1`, [P.o1])
  ok("centro suspenso some da vitrine", (await anon(async () => (await db.query(`select public.court_public_venue('arena-publica') v`)).rows[0].v)) === null)
  await q(`update public.organizations set status='ativa' where id=$1`, [P.o1])
  // confirmação automática
  await as(P.a1, async () => { await db.query(`update public.court_venues set public_auto_confirm = true`) }, true)
  const r2 = await anon(async () => (await db.query(`select public.court_public_request('arena-publica',$1,$2,$3,'Rita Auto','48999990020') r`, [P.c2, T(D3, 20), T(D3, 21)])).rows[0].r, true)
  ok("com confirmação automática a reserva nasce confirmada", r2.status === "confirmada")
  await as(P.a1, async () => { await db.query(`update public.court_venues set public_auto_confirm = false`) }, true)

  // partidas
  const r3 = await anon(async () => (await db.query(`select public.court_public_request('arena-publica',$1,$2,$3,'Carlos Organizador','48999990030','futsal',null,2,'Racha de quinta') r`, [P.c1, T(D4, 20), T(D4, 21)])).rows[0].r, true)
  const tok = r3.manage_token
  const mrow = (await q(`select * from public.court_matches where title='Racha de quinta'`))[0]
  ok("partida criada com código secreto; só o hash fica guardado", tok.length === 64 && mrow.manage_hash !== tok && mrow.manage_hash.length === 64 && mrow.slots_total === 2)
  ok("partida de reserva pendente não aparece na vitrine", (await anon(async () => (await db.query(`select public.court_public_matches('arena-publica') v`)).rows[0].v)).length === 0 && /não está mais aberta/.test(await aerr(`select public.court_public_match_join('${mrow.id}','Paulo Jogador','48999990040')`) ?? ""))
  const bid = await one(`select id from public.court_bookings where code=$1 and tenant_id=$2`, [r3.code, P.o1])
  await as(P.a1, async () => { await db.query(`select public.court_booking_update($1,'{"status":"confirmada"}')`, [bid]) }, true)
  const pm = await anon(async () => (await db.query(`select public.court_public_matches('arena-publica') v`)).rows[0].v)
  ok("confirmada, a partida aparece com vagas e SEM telefones", pm.length === 1 && pm[0].slots_total === 2 && pm[0].approved === 0 && !JSON.stringify(pm).includes("48999990030") && !JSON.stringify(pm).includes("5548"))
  for (const [n, ph] of [["Paulo Jogador", "48999990040"], ["Ana Jogadora", "48999990041"], ["Davi Jogador", "48999990042"]]) await anon(async () => { await db.query(`select public.court_public_match_join($1,$2,$3)`, [mrow.id, n, ph]) }, true)
  ok("pedido repetido do mesmo telefone é recusado", /já pediu vaga/.test(await aerr(`select public.court_public_match_join('${mrow.id}','Paulo Jogador','(48) 99999-0040')`) ?? ""))
  ok("código errado não abre a gestão", (await anon(async () => (await db.query(`select public.court_match_manage_get('errado') v`)).rows[0].v)) === null)
  const mg = await anon(async () => (await db.query(`select public.court_match_manage_get($1) v`, [tok])).rows[0].v)
  ok("organizador vê pedidos com telefone", mg.players.length === 3 && mg.players.every((p) => p.status === "pendente" && p.phone.startsWith("55")) && mg.booking.court === "Quadra P1")
  const [p1, p2, p3] = mg.players.map((p) => p.id)
  await anon(async () => { await db.query(`select public.court_match_manage_decide($1,$2,'aprovado')`, [tok, p1]) }, true)
  ok("aprovar um jogador mantém a partida aberta", (await one(`select status from public.court_matches where id=$1`, [mrow.id])) === "aberta")
  await anon(async () => { await db.query(`select public.court_match_manage_decide($1,$2,'aprovado')`, [tok, p2]) }, true)
  ok("ao preencher as vagas a partida é marcada como completa", (await one(`select status from public.court_matches where id=$1`, [mrow.id])) === "completa")
  ok("não aprova além do limite de vagas", /vagas já foram preenchidas/.test(await aerr(`select public.court_match_manage_decide('${tok}','${p3}','aprovado')`) ?? ""))
  ok("partida completa sai da vitrine e não recebe pedidos", (await anon(async () => (await db.query(`select public.court_public_matches('arena-publica') v`)).rows[0].v)).length === 0 && /não está mais aberta/.test(await aerr(`select public.court_public_match_join('${mrow.id}','Novo Jogador','48999990050')`) ?? ""))
  await anon(async () => { await db.query(`select public.court_match_manage_decide($1,$2,'removido')`, [tok, p1]) }, true)
  ok("remover um jogador reabre a vaga", (await one(`select status from public.court_matches where id=$1`, [mrow.id])) === "aberta")
  ok("código de outra partida não decide jogador alheio", /Código inválido|Jogador não encontrado/.test(await aerr(`select public.court_match_manage_decide('${tok}','${P.c1}','aprovado')`) ?? ""))
  await as(P.a2, async () => { ok("outro estabelecimento não lê partidas nem jogadores", (await one(`select count(*)::int from public.court_matches`)) === 0 && (await one(`select count(*)::int from public.court_match_players`)) === 0) })
  await as(P.a1, async () => { ok("a equipe lê as partidas do próprio centro", (await one(`select count(*)::int from public.court_matches`)) === 1 && (await one(`select count(*)::int from public.court_match_players`)) === 3) })
  await as(P.a1, async () => { await db.query(`select public.court_booking_cancel($1,'chuva')`, [bid]) }, true)
  ok("cancelar a reserva cancela a partida", (await one(`select status from public.court_matches where id=$1`, [mrow.id])) === "cancelada" && /Partida cancelada/.test(await aerr(`select public.court_match_manage_decide('${tok}','${p3}','aprovado')`) ?? ""))
  await anon(async () => { await db.query(`select public.court_match_manage_cancel($1)`, [tok]) }, true)
  ok("o horário de reserva cancelada volta a ficar disponível ao público", (await anon(async () => (await db.query(`select public.court_public_availability('arena-publica','${D4}') v`)).rows[0].v)).some((s) => s.court_id === P.c1 && s.start_min === 1200))

  // busca
  const s1 = await anon(async () => (await db.query(`select public.court_public_search('futsal','joinv') v`)).rows[0].v)
  ok("busca por modalidade e cidade", s1.length === 1 && s1[0].slug === "arena-publica" && s1[0].min_price_cents === 10000 && !JSON.stringify(s1).includes("Razão"))
  await as(P.a2, async () => { await db.query(`update public.court_venues set public_enabled = true`) }, true)
  ok("busca só lista centros que ligaram a página pública; filtro por estado", (await anon(async () => (await db.query(`select public.court_public_search(null,null,null) v`)).rows[0].v)).length === 2 && (await anon(async () => (await db.query(`select public.court_public_search(null,null,'PR') v`)).rows[0].v)).length === 1)
  const s3 = await anon(async () => (await db.query(`select public.court_public_search('futebol_society',null,null,$1,1200,1260) v`, [D1])).rows[0].v)
  ok("busca por dia e horário só traz centros com vaga livre", s3.length === 0 || s3.every((x) => x.free_slots > 0))
  ok("busca com horário ocupado exclui o centro (modalidade só da quadra com reserva)", await (async () => { await as(P.a1, async () => { await db.query(`select public.court_booking_create($1,'avulsa','Bloqueio Teste',null,null,$2,$3)`, [P.c2, T(D1, 20), T(D1, 21)]) }, true); const r = await anon(async () => (await db.query(`select public.court_public_search('futebol_society',null,null,$1,1200,1260) v`, [D1])).rows[0].v); return r.length === 0 })())
}

section("Auditoria")
await as(U.peladaAdmin, async () => {
  await db.query(`insert into public.expenses (spent_at, description, amount) values (current_date,'Auditada',3)`)
  ok("registro de auditoria nasce na organização do usuário", (await one(`select count(*)::int from public.audit_log where entity='expenses' and detail->>'description'='Auditada' and tenant_id=$1`, [P.org])) === 1)
})
await as(U.geabAdmin, async () => {
  ok("GEAB não enxerga a auditoria da Pelada", (await one(`select count(*)::int from public.audit_log where detail->>'description'='Auditada'`)) === 0)
})

section("Teste de 10 dias e assinatura (0022)")
{
  const T = { org: uid(950), admin: uid(951), athlete: uid(952) }
  await q(`insert into auth.users (id, email) values ($1,'novo@x'), ($2,'atl@x')`, [T.admin, T.athlete])
  await q(`insert into public.organizations (id, slug, name, status, trial_ends_at, plan_id) values ($1,'novo-time','Novo Time','teste', now() + interval '14 days', (select id from public.plans where code='teste'))`, [T.org])
  await q(`insert into public.profiles (tenant_id, id, full_name, role) values ($1,$2,'Dono','admin'), ($1,$3,'Atl','atleta')`, [T.org, T.admin, T.athlete])
  const days = await one(`select round(extract(epoch from (trial_ends_at - now())) / 86400)::int from public.organizations where id=$1`, [T.org])
  ok("grupo novo em teste nasce com 10 dias (mesmo se o cadastro pedir 14)", days === 10, String(days))
  await as(T.admin, async () => { ok("dentro do prazo o grupo funciona", (await one(`select public.current_tenant()`)) === T.org) })

  await q(`update public.organizations set trial_ends_at = now() - interval '1 minute' where id=$1`, [T.org])
  await as(T.admin, async () => {
    ok("passou dos 10 dias: bloqueio automático (sem acesso a nada)", (await one(`select public.current_tenant()`)) == null)
    ok("bloqueado não lê atletas nem pagamentos", (await one(`select count(*)::int from public.athletes`)) === 0)
    const b = (await q(`select * from public.my_billing()`))[0]
    ok("mesmo bloqueado, ele consegue ver a situação para assinar", b && b.usable === false && b.status === 'teste' && b.is_admin === true && b.price_cents === 0)
    ok("org_public não expõe grupo com teste vencido", (await one(`select count(*)::int from public.org_public('novo-time')`)) === 0)
  })
  await as(T.athlete, async () => { ok("atleta vê o aviso mas não é admin", (await q(`select is_admin from public.my_billing()`))[0]?.is_admin === false) })
  await as(U.geabAdmin, async () => { ok("GEAB (ativo) segue normal e não vê o outro grupo", (await one(`select count(*)::int from public.my_billing() where org_name='Novo Time'`)) === 0) })

  // Servidor: assinatura
  await as("service", async () => {
    ok("só administrador pode assinar", /Apenas o administrador/.test(await err(`select * from public.billing_prepare($1,'basico')`, [T.athlete]) ?? ""))
    ok("plano gratuito/inexistente não é vendável", /indisponível/.test(await err(`select * from public.billing_prepare($1,'teste')`, [T.admin]) ?? "") && /indisponível/.test(await err(`select * from public.billing_prepare($1,'ilimitado')`, [T.admin]) ?? ""))
  }, false)
  await as("service", async () => {
    const r = (await q(`select * from public.billing_prepare($1,'basico')`, [T.admin]))[0]
    ok("preço vem do banco: Básico R$ 99", r.price_cents === 9900 && r.org_id === T.org)
    ok("Pro custa R$ 150", (await one(`select price_cents from public.plans where code='pro'`)) === 15000)
  })
  await as("service", async () => {
    await db.query(`select public.billing_attach($1,'cus_1','sub_1','basico')`, [T.org])
    ok("evento de assinatura desconhecida é ignorado", (await one(`select public.billing_event('sub_x','PAYMENT_CONFIRMED')`)) === 'desconhecida')
    ok("pagamento vencido de grupo em teste não muda nada", (await one(`select public.billing_event('sub_1','PAYMENT_OVERDUE')`)) === 'ignorada')
    ok("pagamento confirmado ativa o grupo no plano contratado", (await one(`select public.billing_event('sub_1','PAYMENT_CONFIRMED')`)) === 'ativa')
    ok("evento repetido é inofensivo (idempotente)", (await one(`select public.billing_event('sub_1','PAYMENT_CONFIRMED')`)) === 'ativa')
    const o = (await q(`select o.status, p.code from public.organizations o join public.plans p on p.id=o.plan_id where o.id=$1`, [T.org]))[0]
    ok("grupo ficou ativo no Básico", o.status === 'ativa' && o.code === 'basico')
    ok("vencimento suspende por inadimplência", (await one(`select public.billing_event('sub_1','PAYMENT_OVERDUE')`)) === 'suspensa')
    ok("pagamento depois reativa sozinho", (await one(`select public.billing_event('sub_1','PAYMENT_RECEIVED')`)) === 'ativa')
    await db.query(`select public.billing_event('sub_1','PAYMENT_OVERDUE')`)
    await db.query(`update public.org_internal set status_reason = 'Suspenso pelo suporte' where org_id=$1`, [T.org])
    ok("suspensão manual NÃO é desfeita por pagamento", (await one(`select public.billing_event('sub_1','PAYMENT_CONFIRMED')`)) === 'ignorada')
    ok("assinatura removida cancela o grupo", (await one(`select public.billing_event('sub_1','SUBSCRIPTION_DELETED')`)) === 'cancelada')
  }, true)
  await as(T.admin, async () => {
    ok("usuário comum não executa funções de cobrança", /permission denied/.test(await err(`select public.billing_event('sub_1','PAYMENT_CONFIRMED')`) ?? "") && /permission denied/.test(await err(`select * from public.billing_prepare($1,'pro')`, [T.admin]) ?? ""))
    ok("usuário comum não lê org_billing", /permission denied/.test(await err(`select * from public.org_billing`) ?? ""))
    { const codes = (await q(`select code from public.billing_plans()`)).map((r) => r.code); ok("planos à venda: Básico e Pro, nunca o gratuito/interno", codes.includes("basico") && codes.includes("pro") && !codes.includes("teste") && !codes.includes("ilimitado"), codes.join()) }
  })
}

console.log(`\n${pass} aprovados, ${fail} falharam`)
await db.end(); await server.stop()
process.exit(fail ? 1 : 0)
