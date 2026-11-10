// Aplica UM arquivo de migration no Supabase, numa transação (se algo falhar, nada é aplicado).
// Uso: DATABASE_URL='postgresql://…' node scripts/run-migration.mjs supabase/migrations/0015_lineups.sql
import pg from "pg"
import fs from "node:fs"

const url = process.env.DATABASE_URL, file = process.argv[2]
if (!url || !file) { console.error("Uso: DATABASE_URL='…' node scripts/run-migration.mjs <arquivo.sql>"); process.exit(1) }
const sql = fs.readFileSync(file, "utf8")
const db = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } })
await db.connect()
try {
  await db.query("begin")
  await db.query(sql)
  await db.query("commit")
  console.log(`OK: ${file} aplicada com sucesso.`)
} catch (e) {
  await db.query("rollback").catch(() => {})
  console.error(`ERRO em ${file}: ${e.message}\nNada foi alterado (transação desfeita).`)
  process.exitCode = 1
} finally { await db.end() }
