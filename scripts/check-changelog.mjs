// Roda antes do build: a versão do package.json precisa estar no histórico, em formato semver, em ordem decrescente.
import fs from "node:fs"
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const { entries } = JSON.parse(fs.readFileSync(new URL("../src/data/changelog.json", import.meta.url), "utf8"))
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] }
const fail = (m) => { console.error("✗ Histórico de versões:", m); process.exit(1) }
if (!semver.test(pkg.version)) fail(`versão "${pkg.version}" do package.json não segue MAJOR.MINOR.PATCH`)
for (const e of entries) {
  if (!semver.test(e.version)) fail(`entrada "${e.version}" inválida`)
  if (e.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) fail(`data inválida em ${e.version}`)
}
for (let i = 1; i < entries.length; i++) if (cmp(entries[i - 1].version, entries[i].version) <= 0) fail(`ordem errada: ${entries[i - 1].version} deve vir antes de ${entries[i].version}`)
const cur = entries.find((e) => e.version === pkg.version)
if (!cur) fail(`a versão ${pkg.version} do package.json não tem entrada em src/data/changelog.json`)
if (cur.date === null) fail(`a versão ${pkg.version} precisa da data de publicação (date)`)
console.log(`✓ Versão ${pkg.version} (${cur.date}) com histórico completo`)
