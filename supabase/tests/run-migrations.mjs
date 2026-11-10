import EmbeddedPostgres from "embedded-postgres"
import pg from "pg"
import fs from "node:fs"
import path from "node:path"
// Aplica todas as migrations num Postgres local descartável (imitando o Supabase) para validar o SQL.
// Uso: npm i --no-save embedded-postgres pg && node supabase/tests/run-migrations.mjs
import { fileURLToPath } from "node:url"
const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, "..", "migrations")
const server = new EmbeddedPostgres({ databaseDir: path.join(here, ".pgdata"), user: "postgres", password: "test", port: 54330, persistent: false, onLog: () => {}, onError: () => {} })
await server.initialise(); await server.start(); await server.createDatabase("geab_test")
const c = new pg.Client({ connectionString: "postgresql://postgres:test@localhost:54330/geab_test" }); await c.connect()
await c.query(fs.readFileSync(path.join(here, "supabase-stub.sql"), "utf8"))
let failed = 0
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  try { await c.query(fs.readFileSync(path.join(dir, f), "utf8")); console.log("OK  ", f) }
  catch (e) { failed++; console.log("FALHA", f, "->", e.message) }
}
const t = await c.query("select count(*)::int n from pg_tables where schemaname='public'"); console.log("tabelas em public:", t.rows[0].n)
await c.end(); await server.stop(); process.exit(failed ? 1 : 0)
