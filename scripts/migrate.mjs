// Aplica as migrations que ainda não foram aplicadas no banco (Supabase), em ordem, cada uma numa transação.
// O controle fica na tabela public.schema_migrations. Lê DATABASE_URL de .env.deploy (arquivo local, fora do Git).
//   node --env-file=.env.deploy scripts/migrate.mjs --status          lista aplicadas e pendentes
//   node --env-file=.env.deploy scripts/migrate.mjs --baseline 0021   (1ª vez) marca até 0021 como já aplicadas, sem executar
//   node --env-file=.env.deploy scripts/migrate.mjs                    aplica as pendentes
import pg from "pg"
import fs from "node:fs"
import path from "node:path"

const url = process.env.DATABASE_URL
if (!url) { console.error("DATABASE_URL vazio. Preencha em .env.deploy (Supabase → Connect → Session pooler)."); process.exit(1) }
const dir = path.join(import.meta.dirname, "..", "supabase", "migrations")
const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
const args = process.argv.slice(2)
const bi = args.indexOf("--baseline")

const db = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } })
await db.connect()
try {
  await db.query(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`)
  await db.query(`alter table public.schema_migrations enable row level security`)
  const done = new Set((await db.query(`select name from public.schema_migrations`)).rows.map((r) => r.name))

  if (bi >= 0) {
    const upto = args[bi + 1]
    if (!/^\d{4}$/.test(upto ?? "")) throw new Error("Use --baseline NNNN (ex.: --baseline 0021)")
    for (const f of files.filter((f) => f.slice(0, 4) <= upto && !done.has(f))) { await db.query(`insert into public.schema_migrations (name) values ($1)`, [f]); console.log(`marcada como já aplicada: ${f}`) }
    process.exit(0)
  }
  const pending = files.filter((f) => !done.has(f))
  if (args.includes("--status")) { for (const f of files) console.log(`${done.has(f) ? "aplicada " : "PENDENTE "} ${f}`); process.exit(0) }
  if (done.size === 0 && pending.length > 1) throw new Error("Controle vazio: rode antes --baseline NNNN com a última migration que o banco já tem (veja --status).")
  if (!pending.length) { console.log("Nada a aplicar: banco em dia."); process.exit(0) }
  for (const f of pending) {
    try {
      await db.query("begin")
      await db.query(fs.readFileSync(path.join(dir, f), "utf8"))
      await db.query(`insert into public.schema_migrations (name) values ($1)`, [f])
      await db.query("commit")
      console.log(`OK  ${f}`)
    } catch (e) { await db.query("rollback").catch(() => {}); throw new Error(`${f}: ${e.message} (nada desta migration foi alterado)`) }
  }
} catch (e) { console.error(`ERRO: ${e.message}`); process.exitCode = 1 } finally { await db.end() }
