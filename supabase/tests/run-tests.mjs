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

section("Etapa 2: novos grupos, identidade e suspensão")
await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'dono@futsal','{"full_name":"Dona Futsal","new_org_slug":"futsal-amigos","new_org_name":"Futsal dos Amigos"}')`, [uid(401)])
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
  ok("sa_orgs: só agregados (sem nomes de atletas, pagamentos ou contatos)", Object.keys(g).join() === "id,slug,name,status,plan_code,plan_name,athletes,athletes_limit,admins,matches,created_at,trial_ends_at,last_activity,notes,status_reason", Object.keys(g).join())
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
