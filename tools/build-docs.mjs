// Gera src/data/docs.generated.json a partir de docs/*.md (capítulos escritos à mão) e do próprio código
// (migrations, tabelas, funções SQL, páginas, rotas de API, variáveis de ambiente, histórico de versões).
// Roda em todo build (prebuild): a documentação publicada sempre reflete o código publicado.
// Lembretes de descrição faltando saem como aviso (não quebram o build): preencha docs/descricoes.json.
import fs from "node:fs"
import path from "node:path"

const root = new URL("..", import.meta.url).pathname
const rd = (p) => fs.readFileSync(path.join(root, p), "utf8")
const exists = (p) => fs.existsSync(path.join(root, p))
const walk = (dir, out = []) => {
  if (!exists(dir)) return out
  for (const f of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = path.join(dir, f.name)
    if (f.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const pkg = JSON.parse(rd("package.json"))
const { entries } = JSON.parse(rd("src/data/changelog.json"))
const desc = exists("docs/descricoes.json") ? JSON.parse(rd("docs/descricoes.json")) : { env: {}, pages: {}, apis: {} }
const missing = []

// ── Capítulos escritos à mão ──
const chapters = walk("docs").filter((f) => /docs\/\d+.*\.md$/.test(f)).sort().map((f) => {
  const md = rd(f)
  const rev = md.match(/<!--\s*revisado:\s*(\d+\.\d+\.\d+)\s*-->/)?.[1] ?? null
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(f)
  return { id: path.basename(f, ".md").replace(/^\d+-/, ""), title, revisado: rev, markdown: md.replace(/<!--[\s\S]*?-->/g, "").trim() }
})

// ── Migrations, tabelas e funções ──
const migFiles = walk("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()
const migrations = migFiles.map((f) => {
  const lines = rd(f).split("\n")
  const comments = []
  for (const l of lines) { if (/^--\s?/.test(l)) comments.push(l.replace(/^--\s?/, "").trim()); else if (l.trim() === "" && comments.length === 0) continue; else break }
  const summary = comments.filter(Boolean).slice(0, 2).join(" ").slice(0, 320)
  return { file: path.basename(f), summary: summary || "(sem comentário de cabeçalho)" }
})
const tables = new Map(), fns = new Map()
for (const f of migFiles) {
  const sql = rd(f), base = path.basename(f)
  for (const m of sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)) if (!tables.has(m[1])) tables.set(m[1], base)
  for (const m of sql.matchAll(/create (?:or replace )?function public\.(\w+)/gi)) fns.set(m[1], base)   // guarda a última definição
}
const prefix = (n) => (/^sa_/.test(n) ? "Painel do SaaS" : /^billing_|^my_billing|^org_usable/.test(n) ? "Cobrança" : /^admin_/.test(n) ? "Administração do grupo" : /support|spy/.test(n) ? "Modo espião" : "Geral")
const functions = [...fns].map(([name, file]) => ({ name, file, area: prefix(name) })).sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name))

// ── Páginas e rotas ──
const adminOnly = [...(rd("src/lib/roles.ts").match(/ADMIN_ONLY\s*=\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1])
const PUBLIC = ["/site", "/demo", "/login", "/cadastro", "/novo-grupo", "/recuperar", "/redefinir-senha"]
const access = (p) => p.startsWith("/super") ? "Dono da plataforma" : p === "/atleta" ? "Atleta" : PUBLIC.some((x) => p === x || p.startsWith(x + "/")) ? "Público" : p === "/cadastro/status" ? "Logado sem grupo" : adminOnly.some((x) => p === x || p.startsWith(x + "/")) ? "Administrador" : "Administrador e Diretoria"
const pages = walk("src/app").filter((f) => /\/page\.tsx$/.test(f)).map((f) => {
  const p = "/" + path.dirname(f).replace(/^src\/app\/?/, "").split("/").filter((s) => s && !/^\(.*\)$/.test(s)).join("/")
  const url = p === "/" ? "/" : p.replace(/\/$/, "")
  const d = desc.pages?.[url]; if (!d) missing.push(`página ${url}`)
  return { path: url, access: access(url), description: d ?? null }
}).sort((a, b) => a.path.localeCompare(b.path))
const apis = walk("src/app/api").filter((f) => /\/route\.ts$/.test(f)).map((f) => {
  const src = rd(f)
  const methods = [...new Set([...src.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]))]
  const url = "/" + path.dirname(f).replace(/^src\/app\//, "")
  const d = desc.apis?.[url]; if (!d) missing.push(`API ${url}`)
  return { path: url, methods, description: d ?? null }
}).sort((a, b) => a.path.localeCompare(b.path))

// ── Variáveis de ambiente usadas pelo aplicativo (só os NOMES; nunca valores). As das ferramentas de deploy estão no capítulo de operação. ──
const env = new Map()
for (const f of walk("src").filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))) {
  for (const m of rd(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
    if (m[1] === "NODE_ENV" || m[1] === "NEXT_PUBLIC_BUILD_ID") continue
    if (!env.has(m[1])) env.set(m[1], new Set())
    env.get(m[1]).add(f)
  }
}
const envList = [...env].map(([name, files]) => {
  const d = desc.env?.[name]; if (!d) missing.push(`variável ${name}`)
  return { name, scope: name.startsWith("NEXT_PUBLIC_") ? "Navegador (gravada no build)" : "Servidor", description: d ?? null, uses: files.size }
}).sort((a, b) => a.name.localeCompare(b.name))

const cur = entries.find((e) => e.version === pkg.version)

const out = {
  version: pkg.version, versionDate: cur?.date ?? null,
  stack: { next: pkg.dependencies?.next ?? null, react: pkg.dependencies?.react ?? null, supabase: pkg.dependencies?.["@supabase/supabase-js"] ?? null },
  chapters, migrations, tables: [...tables].map(([name, file]) => ({ name, file })).sort((a, b) => a.name.localeCompare(b.name)),
  functions, pages, apis, env: envList, changelog: entries,
  stats: { migrations: migrations.length, tables: tables.size, functions: functions.length, pages: pages.length, apis: apis.length },
}
const file = path.join(root, "src/data/docs.generated.json")
const next = JSON.stringify(out, null, 1) + "\n"
if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== next) fs.writeFileSync(file, next)
console.log(`✓ Documentação gerada (v${pkg.version}): ${chapters.length} capítulos, ${migrations.length} migrations, ${tables.size} tabelas, ${functions.length} funções, ${pages.length} páginas, ${apis.length} APIs, ${envList.length} variáveis`)
if (missing.length) console.warn(`⚠ ${missing.length} item(ns) sem descrição em docs/descricoes.json: ${missing.slice(0, 8).join("; ")}${missing.length > 8 ? "…" : ""}`)
const stale = chapters.filter((c) => !c.revisado)
if (stale.length) console.warn(`⚠ capítulos sem marca de revisão: ${stale.map((c) => c.id).join(", ")}`)
