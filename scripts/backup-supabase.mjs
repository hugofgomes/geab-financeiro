// Backup de DADOS do Supabase (para o plano gratuito, que não tem backup automático).
// Grava cada tabela do schema "public" e os usuários de login (auth.users) em arquivos JSON, mais um manifesto com as contagens.
// A ESTRUTURA do banco já está nas migrations do repositório. Os arquivos gerados contêm dados pessoais e hashes de senha: NÃO comite, guarde em local seguro.
//
// Uso (no Terminal, dentro da pasta do projeto):
//   npm i --no-save pg
//   DATABASE_URL='postgresql://postgres.xxxx:SENHA@aws-0-regiao.pooler.supabase.com:5432/postgres' node scripts/backup-supabase.mjs
import pg from "pg"
import fs from "node:fs"
import path from "node:path"

const url = process.env.DATABASE_URL
if (!url) { console.error("Defina DATABASE_URL (Supabase → Connect → Session pooler)."); process.exit(1) }

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2")
const dir = path.join("backups", stamp)
fs.mkdirSync(dir, { recursive: true })

const db = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } })
await db.connect()
await db.query("begin transaction isolation level repeatable read read only")   // fotografia consistente de todas as tabelas

const tables = (await db.query(`select schemaname || '.' || tablename as t from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.t)
tables.push("auth.users")
const manifest = { created_at: new Date().toISOString(), tables: {} }
for (const t of tables) {
  try {
    const rows = (await db.query(`select * from ${t}`)).rows
    fs.writeFileSync(path.join(dir, t.replace(".", "__") + ".json"), JSON.stringify(rows))
    manifest.tables[t] = rows.length
    console.log(String(rows.length).padStart(7), t)
  } catch (e) { manifest.tables[t] = `ERRO: ${e.message}`; console.error("  FALHOU", t, "->", e.message) }
}
await db.query("rollback")
await db.end()
fs.writeFileSync(path.join(dir, "_manifest.json"), JSON.stringify(manifest, null, 2))
const failed = Object.values(manifest.tables).some((v) => typeof v === "string")
console.log(`\n${failed ? "CONCLUÍDO COM ERROS" : "Backup concluído"}: ${path.resolve(dir)}`)
process.exit(failed ? 1 : 0)
