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
async function as(who, fn) {
  await db.query("begin")
  try {
    if (who === "service") await db.query("set local role service_role")
    else { await db.query("set local role authenticated"); await db.query("select set_config('request.jwt.claim.sub', $1, true)", [who]) }
    return await fn()
  } finally { await db.query("rollback") }
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
for (const t of Object.keys(before)) {
  const n = await one(`select count(*)::int from public.${t}`)
  const orphan = await one(`select count(*)::int from public.${t} where tenant_id is distinct from $1`, [geab])
  ok(`${t}: ${before[t]} linhas preservadas, todas na organização geab`, n === before[t] && orphan === 0, `n=${n} orfas=${orphan}`)
}

// Transição: com uma única organização, o servidor ainda grava sem informar o tenant.
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

section("Auditoria")
await as(U.peladaAdmin, async () => {
  await db.query(`insert into public.expenses (spent_at, description, amount) values (current_date,'Auditada',3)`)
  ok("registro de auditoria nasce na organização do usuário", (await one(`select count(*)::int from public.audit_log where entity='expenses' and detail->>'description'='Auditada' and tenant_id=$1`, [P.org])) === 1)
})
await as(U.geabAdmin, async () => {
  ok("GEAB não enxerga a auditoria da Pelada", (await one(`select count(*)::int from public.audit_log where detail->>'description'='Auditada'`)) === 0)
})

console.log(`\n${pass} aprovados, ${fail} falharam`)
await db.end(); await server.stop()
process.exit(fail ? 1 : 0)
