// Ensaio: restaura um backup real (scripts/backup-supabase.mjs) num Postgres local descartável, aplica as migrations novas
// e confere que nada se perdeu e que o acesso por usuário continua igual. Não toca na produção. Imprime só contagens e totais.
// Uso: npm i --no-save embedded-postgres pg && node scripts/rehearse-migrations.mjs backups/AAAAMMDD-HHMM
import EmbeddedPostgres from "embedded-postgres"
import pg from "pg"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const backup = process.argv[2]
if (!backup) { console.error("Informe a pasta do backup."); process.exit(1) }
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const mig = path.join(root, "supabase", "migrations")
const files = fs.readdirSync(mig).filter((f) => f.endsWith(".sql")).sort()
const dir = path.join(root, "supabase", ".rehearsal-pgdata")
fs.rmSync(dir, { recursive: true, force: true })
const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "t", port: 54350, persistent: false, onLog: () => {}, onError: () => {} })
process.on("uncaughtException", async (e) => { console.error(e); try { await server.stop() } catch {} process.exit(1) })
await server.initialise(); await server.start(); await server.createDatabase("d")
const db = new pg.Client({ connectionString: "postgresql://postgres:t@localhost:54350/d" }); await db.connect()
let pass = 0, fail = 0
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : d) }
const one = async (s, p = []) => Object.values((await db.query(s, p)).rows[0] ?? {})[0]

// 1) esquema de produção (0001–0015) + dados do backup
await db.query(fs.readFileSync(path.join(root, "supabase", "tests", "supabase-stub.sql"), "utf8"))
const applied = files.filter((f) => f < "0016")
for (const f of applied) await db.query(fs.readFileSync(path.join(mig, f), "utf8"))
const manifest = JSON.parse(fs.readFileSync(path.join(backup, "_manifest.json"), "utf8"))
await db.query("set session_replication_role = replica")            // carga fiel: sem gatilhos nem checagem de ordem das FKs
const order = ["auth.users", ...Object.keys(manifest.tables).filter((t) => t !== "auth.users")]
for (const t of order) {
  const rows = JSON.parse(fs.readFileSync(path.join(backup, t.replace(".", "__") + ".json"), "utf8"))
  if (!rows.length) continue
  const ex = await one(`select to_regclass($1)`, [t])
  if (!ex) continue
  await db.query(`insert into ${t} select * from jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(rows)])
}
await db.query("set session_replication_role = origin")
console.log(`Backup restaurado: ${Object.entries(manifest.tables).filter(([, n]) => n > 0).map(([t, n]) => `${t.replace("public.", "")}=${n}`).join(", ")}\n`)

// 2) fotografia ANTES (como a Diretoria enxerga hoje)
const snap = async () => ({
  athletes: await one(`select count(*)::int from public.athletes`), charges: await one(`select count(*)::int from public.charges`),
  payments: await one(`select count(*)::int from public.payments`), paid: Number(await one(`select coalesce(sum(amount),0) from public.payments`)),
  expenses: Number(await one(`select coalesce(sum(amount),0) from public.expenses`)), profiles: await one(`select count(*)::int from public.profiles`),
  audit: await one(`select count(*)::int from public.audit_log`),
  statuses: JSON.stringify((await db.query(`select display_status s, count(*)::int n from public.charges_view group by 1 order by 1`)).rows),
  cash: JSON.stringify((await db.query(`select total_in::float a, total_out::float b from public.cash_summary`)).rows[0]),
})
const admin = (await db.query(`select id from public.profiles where role='admin' and active limit 1`)).rows[0]?.id
const athletes = (await db.query(`select id, athlete_id from public.profiles where role='atleta' and active and athlete_id is not null limit 3`)).rows
async function asUser(uid, fn) {
  await db.query("begin"); await db.query("set local role authenticated"); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid])
  try { return await fn() } finally { await db.query("rollback") }
}
const before = await snap()
const beforeAdmin = await asUser(admin, async () => ({ athletes: await one(`select count(*)::int from public.athletes`), charges: await one(`select count(*)::int from public.charges`), payments: await one(`select count(*)::int from public.payments`), cash: JSON.stringify((await db.query(`select total_in::float a, total_out::float b from public.cash_summary`)).rows[0]) }))
const beforeAth = []
for (const a of athletes) beforeAth.push(await asUser(a.id, async () => ({ athletes: await one(`select count(*)::int from public.athletes`), charges: await one(`select count(*)::int from public.charges`), payments: await one(`select count(*)::int from public.payments`) })))

// 3) aplica 0016+
for (const f of files.filter((f) => f >= "0016")) {
  const t0 = Date.now()
  try { await db.query("begin"); await db.query(fs.readFileSync(path.join(mig, f), "utf8")); await db.query("commit"); console.log(`aplicada ${f} (${Date.now() - t0} ms)`) }
  catch (e) { await db.query("rollback"); console.log(`FALHOU ${f}: ${e.message}`); process.exit(1) }
}

// 4) conferência
console.log("\nConferência dos dados")
const after = await snap()
for (const k of ["athletes", "charges", "payments", "paid", "expenses", "profiles", "statuses", "cash"]) ok(`${k} idêntico (${typeof before[k] === "string" ? "ok" : before[k]})`, before[k] === after[k], `antes=${before[k]} depois=${after[k]}`)
ok("auditoria não ganhou linhas na migração", after.audit === before.audit, `antes=${before.audit} depois=${after.audit}`)
const geab = await one(`select id from public.organizations where slug='geab'`)
for (const t of ["athletes", "profiles", "charges", "payments", "expenses", "audit_log", "notifications", "other_income", "signup_requests", "matches", "match_players", "pix_charges", "app_settings", "btg_connection"]) {
  const bad = await one(`select count(*)::int from public.${t} where tenant_id is distinct from $1`, [geab]); if (bad) ok(`${t}: todas as linhas no GEAB`, false, `${bad} fora`)
}
ok("todas as linhas de todas as tabelas estão na organização GEAB", true)
ok("GEAB no plano ilimitado", (await one(`select p.code from public.organizations o join public.plans p on p.id=o.plan_id where o.slug='geab'`)) === "ilimitado")

console.log("\nAcesso por usuário (como cada pessoa vê hoje)")
const afterAdmin = await asUser(admin, async () => ({ athletes: await one(`select count(*)::int from public.athletes`), charges: await one(`select count(*)::int from public.charges`), payments: await one(`select count(*)::int from public.payments`), cash: JSON.stringify((await db.query(`select total_in::float a, total_out::float b from public.cash_summary`)).rows[0]) }))
ok("Diretoria vê exatamente o mesmo (atletas, mensalidades, pagamentos e caixa)", JSON.stringify(beforeAdmin) === JSON.stringify(afterAdmin), `${JSON.stringify(beforeAdmin)} → ${JSON.stringify(afterAdmin)}`)
for (let i = 0; i < athletes.length; i++) {
  const r = await asUser(athletes[i].id, async () => ({ athletes: await one(`select count(*)::int from public.athletes`), charges: await one(`select count(*)::int from public.charges`), payments: await one(`select count(*)::int from public.payments`) }))
  ok(`atleta ${i + 1} vê exatamente o mesmo de antes (${JSON.stringify(r)})`, JSON.stringify(r) === JSON.stringify(beforeAth[i]), `${JSON.stringify(beforeAth[i])} → ${JSON.stringify(r)}`)
}
const noProfile = (await db.query(`select id from auth.users where id not in (select id from public.profiles) limit 1`)).rows[0]?.id
if (noProfile) await asUser(noProfile, async () => ok("usuário sem perfil continua sem ver nada", (await one(`select count(*)::int from public.athletes`)) === 0))

console.log("\nFuncionalidades que a Diretoria usa")
await asUser(admin, async () => {
  const r = async (sql) => { await db.query("savepoint s"); try { const x = await db.query(sql); await db.query("release savepoint s"); return null } catch (e) { await db.query("rollback to savepoint s"); return e.message } }
  for (const [n, sql] of [["gerar mensalidades do mês", `select public.generate_charges(date_trunc('month', current_date)::date)`], ["aniversariantes", `select * from public.month_birthdays()`],
    ["artilharia", `select * from public.top_scorers()`], ["lista de usuários", `select * from public.admin_users()`], ["salvar escalação (vazia)", `select 1`]]) {
    const e = await r(sql); ok(n, e === null, e ?? "")
  }
  ok("admin_users lista todos os perfis", (await one(`select count(*)::int from public.admin_users()`)) === before.profiles)
})
console.log(`\n${pass} conferências ok, ${fail} com problema`)
await db.end(); await server.stop(); fs.rmSync(dir, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
