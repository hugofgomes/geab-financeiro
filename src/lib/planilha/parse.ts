// Leitura da planilha do GEAB (uma aba por mês). Código puro, sem dependências: roda no
// navegador, no servidor e nos scripts de verificação.
//
// Estrutura de cada aba: DATA PG | JOGADORES | DEPOSITADO | … | DATA | DESPESAS | (valor) | … blocos laterais … | TOTAL EM CONTA.
// O "saldo anterior" aparece como se fosse um jogador (várias grafias) e NÃO é pagamento.

export type Money = { kind: "num"; v: number } | { kind: "empty" } | { kind: "bad"; raw: string }

export interface RosterEntry {
  row: number
  nameRaw: string
  key: string
  value: Money
  dateRaw: string
  dateISO: string | null
}

export interface ExpenseEntry {
  row: number
  descRaw: string
  amount: Money
  dateRaw: string
  dateISO: string | null
}

export interface ParsedTab {
  name: string
  gid: string
  competence: string // "YYYY-MM-01"
  roster: RosterEntry[]
  carryOver: number // soma das linhas de saldo anterior
  expenses: ExpenseEntry[]
  totalDeposit: number | null // linha TOTAL da planilha
  totalExpenses: number | null
  accountBalance: number | null // "Valor" (TOTAL EM CONTA)
  sideRows: { row: number; cells: string[] }[] // blocos laterais não importados
  warnings: string[]
}

export interface IgnoredTab {
  name: string
  gid: string
  reason: string
}

const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]

export const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")
export const normName = (s: string) => stripAccents(s).toLowerCase().replace(/\s+/g, " ").trim()

/** Nomes que representam saldo anterior (não são jogadores). */
const CARRY = /^(restante|saldo.*|sobra|\d{1,2}\/\d{1,2}\/\d{4})$/

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else q = false
      } else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ",") { row.push(cell); cell = "" }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(cell); rows.push(row); row = []; cell = ""
    } else cell += ch
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row) }
  return rows
}

export function parseMoney(raw: string | undefined): Money {
  const s = (raw ?? "").trim()
  if (!s) return { kind: "empty" }
  const m = s.match(/^(-)?\s*(?:R\$)?\s*(-)?\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/)
  if (!m) return { kind: "bad", raw: s }
  const v = Number(`${m[3].replace(/\./g, "")}.${(m[4] ?? "0").padEnd(2, "0")}`)
  return { kind: "num", v: m[1] || m[2] ? -v : v }
}

export function parseDate(raw: string | undefined): string | null {
  const m = (raw ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

/** "JUNHO_22", "Junho_2025", "MARÇO_23" → "2022-06-01". Abas que não são mês → null. */
export function competenceFromTabName(name: string): string | null {
  const m = stripAccents(name).toLowerCase().trim().match(/^([a-z]+)_(\d{2}|\d{4})$/)
  if (!m) return null
  const mi = MONTHS.indexOf(m[1])
  if (mi < 0) return null
  const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])
  return `${y}-${String(mi + 1).padStart(2, "0")}-01`
}

export function parseTab(name: string, gid: string, csv: string): ParsedTab | IgnoredTab {
  const competence = competenceFromTabName(name)
  if (!competence) return { name, gid, reason: "não é uma aba de mês" }
  const rows = parseCsv(csv)
  if (!rows.length || rows.every((r) => r.every((c) => !c.trim()))) return { name, gid, reason: "aba vazia" }

  const up = rows[0].map((c) => c.trim().toUpperCase())
  const a = up.indexOf("DATA PG")
  const b = up.indexOf("JOGADORES")
  const c = up.includes("DEPOSITADO") ? up.indexOf("DEPOSITADO") : up.indexOf("VALOR PAGO")
  const e = up.indexOf("DATA")
  const f = up.indexOf("DESPESAS")
  if ([a, b, c, e, f].some((i) => i < 0)) return { name, gid, reason: "cabeçalho fora do padrão" }

  const tab: ParsedTab = {
    name, gid, competence, roster: [], carryOver: 0, expenses: [], totalDeposit: null, totalExpenses: null,
    accountBalance: null, sideRows: [], warnings: [],
  }
  const num = (m: Money) => (m.kind === "num" ? m.v : null)

  rows.slice(1).forEach((r0, idx) => {
    const r = [...r0, ...Array(Math.max(0, 16 - r0.length)).fill("")]
    const row = idx + 2
    const nameB = r[b].trim()
    const isTotalDep = nameB.toUpperCase() === "TOTAL" || r[a].trim().toUpperCase() === "TOTAL"
    const isTotalExp = r[e].trim().toUpperCase() === "TOTAL" || r[f].trim().toUpperCase() === "TOTAL"

    if (isTotalDep) tab.totalDeposit = num(parseMoney(r[c]))
    if (isTotalExp) tab.totalExpenses = num(parseMoney(r[f + 1]))

    if (!isTotalDep && nameB) {
      const value = parseMoney(r[c])
      const key = normName(nameB)
      if (CARRY.test(key)) {
        if (value.kind === "num") tab.carryOver += value.v
      } else {
        const dateISO = parseDate(r[a])
        tab.roster.push({ row, nameRaw: nameB, key, value, dateRaw: r[a].trim(), dateISO })
        if (value.kind === "bad") tab.warnings.push(`Linha ${row}: valor ilegível “${value.raw}” para ${nameB}`)
        else if (value.kind === "empty" && r[a].trim()) tab.warnings.push(`Linha ${row}: ${nameB} tem data (${r[a].trim()}) mas não tem valor`)
        else if (value.kind === "num" && value.v <= 0) tab.warnings.push(`Linha ${row}: valor não positivo para ${nameB}`)
        else if (value.kind === "num" && !dateISO) tab.warnings.push(`Linha ${row}: ${nameB} sem data de pagamento (usei o dia 1 do mês)`)
      }
    } else if (!isTotalDep && !nameB && parseMoney(r[c]).kind === "num") {
      tab.warnings.push(`Linha ${row}: valor sem nome de jogador (ignorado)`)
    }

    if (!isTotalExp && r[f].trim()) {
      const amount = parseMoney(r[f + 1])
      const dateISO = parseDate(r[e])
      tab.expenses.push({ row, descRaw: r[f].trim(), amount, dateRaw: r[e].trim(), dateISO })
      if (amount.kind !== "num") tab.warnings.push(`Linha ${row}: despesa “${r[f].trim()}” sem valor válido`)
      else if (!dateISO) tab.warnings.push(`Linha ${row}: despesa “${r[f].trim()}” sem data (usei o dia 1 do mês)`)
    }

    // blocos laterais (patrocínio, uniforme, dinheiro, outros): não importados
    const side = r.slice(f + 2).map((x) => x.trim())
    side.forEach((x, i) => {
      if (x.toLowerCase() === "valor") tab.accountBalance = num(parseMoney(side[i + 1]))
    })
    const cells = side.filter(Boolean)
    const onlyBalance = cells.length > 0 && cells.length <= 2 && cells.some((x) => x.toLowerCase() === "valor")
    if (cells.length && !onlyBalance && !cells.every((x) => /^R\$[\s\d.,-]+$/.test(x))) tab.sideRows.push({ row, cells })
  })
  // mesmo nome duas vezes na mesma aba: pode ser pessoa diferente com o mesmo apelido ou erro de digitação
  const seen = new Map<string, number>()
  for (const r of tab.roster) seen.set(r.key, (seen.get(r.key) ?? 0) + 1)
  for (const [k, n] of seen) if (n > 1) tab.warnings.push(`Nome repetido ${n}x nesta aba: “${tab.roster.find((r) => r.key === k)!.nameRaw}”`)
  return tab
}

export const isParsed = (x: ParsedTab | IgnoredTab): x is ParsedTab => "competence" in x

// ───────── Conferência com os totais da própria planilha ─────────
export interface MonthCheck {
  tab: string
  competence: string
  carryOver: number
  deposits: number
  expenses: number
  endBalance: number // saldo anterior + depósitos − despesas, calculado por nós
  sheetBalance: number | null // "Valor" da planilha
  depositsMatchTotal: boolean | null
  expensesMatchTotal: boolean | null
  balanceMatches: boolean | null
}

const round2 = (n: number) => Math.round(n * 100) / 100
const near = (a: number, b: number) => Math.abs(a - b) < 0.015

export function checkMonths(tabs: ParsedTab[]): MonthCheck[] {
  return tabs.map((t) => {
    const deposits = round2(t.roster.reduce((s, r) => s + (r.value.kind === "num" ? r.value.v : 0), 0))
    const expenses = round2(t.expenses.reduce((s, x) => s + (x.amount.kind === "num" ? x.amount.v : 0), 0))
    const endBalance = round2(t.carryOver + deposits - expenses)
    return {
      tab: t.name, competence: t.competence, carryOver: round2(t.carryOver), deposits, expenses, endBalance,
      sheetBalance: t.accountBalance,
      depositsMatchTotal: t.totalDeposit == null ? null : near(t.carryOver + deposits, t.totalDeposit),
      expensesMatchTotal: t.totalExpenses == null ? null : near(expenses, t.totalExpenses),
      balanceMatches: t.accountBalance == null ? null : near(endBalance, t.accountBalance),
    }
  })
}

// ───────── Sugestão de junção de nomes parecidos ─────────
export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

export interface NameStat { key: string; count: number }
export interface MergeSuggestion { target: string; confidence: "alta" | "media" }

/**
 * alta  = erro de digitação (distância de edição 1): pré-selecionada.
 * media = nome de uma palavra contido em UM único nome maior (ex.: "Massoti" → "Rodrigo Massoti"): só sugerida.
 * O destino é sempre o nome mais frequente do grupo.
 */
export function suggestMerges(stats: NameStat[]): Record<string, MergeSuggestion> {
  const byCount = [...stats].sort((x, y) => y.count - x.count || y.key.length - x.key.length)
  const out: Record<string, MergeSuggestion> = {}
  for (const s of byCount) {
    const better = byCount.filter((o) => o.key !== s.key && (o.count > s.count || (o.count === s.count && o.key.length > s.key.length)))
    const typo = better.filter((o) => Math.min(o.key.length, s.key.length) >= 4 && levenshtein(o.key, s.key) === 1)
    if (typo.length) { out[s.key] = { target: typo[0].key, confidence: "alta" }; continue }
    if (!s.key.includes(" ")) {
      const containing = stats.filter((o) => o.key !== s.key && o.key.split(" ").includes(s.key))
      if (containing.length === 1) out[s.key] = { target: containing[0].key, confidence: "media" }
    }
  }
  // resolve cadeias (a→b→c vira a→c) e evita ciclos
  const root = (k: string, seen = new Set<string>()): string => {
    const nx = out[k]?.target
    if (!nx || seen.has(k)) return k
    seen.add(k)
    return root(nx, seen)
  }
  for (const k of Object.keys(out)) {
    const r = root(k)
    if (r === k) delete out[k]
    else out[k] = { ...out[k], target: r }
  }
  return out
}
