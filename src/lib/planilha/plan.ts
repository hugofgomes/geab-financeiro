import { type ParsedTab, type RosterEntry } from "./parse"

export interface PlanOptions {
  /** Mês corrente ("YYYY-MM-01"). Meses anteriores viram histórico; a partir daqui há cobrança real. */
  currentMonth: string
  /** A partir de qual mês os jogadores listados SEM pagamento geram mensalidade pendente. */
  pendingFrom: string
  fee: number
  dueDay: number
  /** nome normalizado → nome normalizado de destino (junção) */
  alias: Record<string, string>
  /** nome normalizado (raiz) → não importar */
  exclude: Record<string, boolean>
  /** nome normalizado (raiz) → ativo? (sobrescreve o padrão) */
  active: Record<string, boolean>
}

export interface PlanAthlete {
  key: string
  fullName: string
  active: boolean
  joinedAt: string
  tabs: number
  payments: number
  rawNames: string[]
}
export interface PlanCharge { athleteKey: string; competence: string; dueDate: string; amount: number; kind: "historico" | "mensalidade" }
export interface PlanPayment {
  athleteKey: string; competence: string; amount: number; paidAt: string; estimatedDate: boolean; txid: string; tab: string; note: string
}
export interface PlanExpense {
  spentAt: string; description: string; category: string; amount: number; estimatedDate: boolean; tab: string; row: number
}
export interface Plan {
  athletes: PlanAthlete[]
  charges: PlanCharge[]
  payments: PlanPayment[]
  expenses: PlanExpense[]
  balance: { month: string; computed: number; sheet: number | null; diff: number | null }
  skipped: { tab: string; message: string }[]
}

const round2 = (n: number) => Math.round(n * 100) / 100
const lastDayDue = (competence: string, dueDay: number) => `${competence.slice(0, 8)}${String(dueDay).padStart(2, "0")}`

export function resolveKey(key: string, alias: Record<string, string>): string {
  const seen = new Set<string>()
  let k = key
  while (alias[k] && !seen.has(k)) { seen.add(k); k = alias[k] }
  return k
}

function titleCase(raw: string) {
  const t = raw.trim().replace(/\s+/g, " ")
  return t === t.toLowerCase() ? t.replace(/(^|\s)(\p{L})/gu, (_, s, c) => s + c.toUpperCase()) : t
}

/** Quem está listado no mês corrente (ou depois) é considerado ativo por padrão. */
export function defaultActive(tabs: ParsedTab[], currentMonth: string, alias: Record<string, string>) {
  const out = new Set<string>()
  for (const t of tabs) if (t.competence >= currentMonth) for (const r of t.roster) out.add(resolveKey(r.key, alias))
  return out
}

export function categorize(desc: string) {
  const d = desc.toLowerCase()
  if (d.includes("quadra")) return "Quadra"
  if (d.includes("goleiro")) return "Goleiro"
  if (/\bapp\b|aplicativo/.test(d)) return "Aplicativo"
  return "Outros"
}

export function buildPlan(tabsIn: ParsedTab[], o: PlanOptions): Plan {
  const tabs = [...tabsIn].sort((a, b) => a.competence.localeCompare(b.competence))
  const rootOf = (k: string) => resolveKey(k, o.alias)
  const included = (k: string) => !o.exclude[rootOf(k)]
  const defaults = defaultActive(tabs, o.currentMonth, o.alias)

  const athletes = new Map<string, { raws: Map<string, number>; tabs: Set<string>; payments: number; first: string }>()
  const charges: PlanCharge[] = []
  const payments: PlanPayment[] = []
  const expenses: PlanExpense[] = []
  const skipped: Plan["skipped"] = []

  for (const t of tabs) {
    const groups = new Map<string, RosterEntry[]>()
    for (const r of t.roster) {
      if (!included(r.key)) continue
      const root = rootOf(r.key)
      groups.set(root, [...(groups.get(root) ?? []), r])
    }
    for (const [root, entries] of groups) {
      const a = athletes.get(root) ?? { raws: new Map(), tabs: new Set(), payments: 0, first: t.competence }
      athletes.set(root, a)
      a.tabs.add(t.competence)
      if (t.competence < a.first) a.first = t.competence
      for (const e of entries) a.raws.set(e.nameRaw, (a.raws.get(e.nameRaw) ?? 0) + 1)

      const valid = entries.filter((e) => e.value.kind === "num" && e.value.v > 0)
      const paid = round2(valid.reduce((s, e) => s + (e.value.kind === "num" ? e.value.v : 0), 0))
      const isHistory = t.competence < o.pendingFrom
      const isFuture = t.competence > o.currentMonth

      let amount: number | null = null
      if (isHistory) amount = paid > 0 ? paid : null // histórico: o que de fato foi pago; não inventa dívida
      else if (!isFuture || paid > 0) amount = Math.max(o.fee, paid)
      if (amount != null)
        charges.push({ athleteKey: root, competence: t.competence, dueDate: lastDayDue(t.competence, o.dueDay), amount, kind: isHistory ? "historico" : "mensalidade" })

      for (const e of valid) {
        if (e.value.kind !== "num") continue
        a.payments++
        payments.push({
          athleteKey: root, competence: t.competence, amount: e.value.v,
          paidAt: e.dateISO ?? t.competence, estimatedDate: !e.dateISO,
          txid: `planilha:${t.gid}:${e.row}`, tab: t.name,
          note: `Importado da planilha (aba ${t.name}, linha ${e.row})${e.dateISO ? "" : " — data não informada"}`,
        })
      }
    }
    for (const x of t.expenses) {
      if (x.amount.kind !== "num" || x.amount.v <= 0) {
        skipped.push({ tab: t.name, message: `Despesa “${x.descRaw}” (linha ${x.row}) ignorada: valor inválido` })
        continue
      }
      expenses.push({
        spentAt: x.dateISO ?? t.competence, description: x.descRaw, category: categorize(x.descRaw),
        amount: x.amount.v, estimatedDate: !x.dateISO, tab: t.name, row: x.row,
      })
    }
    for (const r of t.roster) {
      if (r.value.kind === "bad") skipped.push({ tab: t.name, message: `${r.nameRaw} (linha ${r.row}): valor “${r.value.raw}” ilegível — pagamento não importado` })
      if (r.value.kind === "empty" && r.dateRaw) skipped.push({ tab: t.name, message: `${r.nameRaw} (linha ${r.row}): tem data mas não tem valor — pagamento não importado` })
    }
  }

  const planAthletes: PlanAthlete[] = [...athletes].map(([key, a]) => {
    const raw = [...a.raws].sort((x, y) => y[1] - x[1] || y[0].length - x[0].length)
    return {
      key, fullName: titleCase(raw[0]?.[0] ?? key), active: o.active[key] ?? defaults.has(key),
      joinedAt: a.first, tabs: a.tabs.size, payments: a.payments, rawNames: raw.map((r) => r[0]),
    }
  })

  const through = (c: string) => c <= o.currentMonth
  const computed = round2(
    payments.filter((p) => through(p.competence)).reduce((s, p) => s + p.amount, 0) -
      expenses.filter((x) => through(tabs.find((t) => t.name === x.tab)!.competence)).reduce((s, x) => s + x.amount, 0),
  )
  const cur = tabs.filter((t) => t.competence <= o.currentMonth && t.accountBalance != null).at(-1)
  const sheet = cur?.accountBalance ?? null
  return {
    athletes: planAthletes.sort((a, b) => Number(b.active) - Number(a.active) || a.fullName.localeCompare(b.fullName)),
    charges, payments, expenses, skipped,
    balance: { month: cur?.competence ?? o.currentMonth, computed, sheet, diff: sheet == null ? null : round2(computed - sheet) },
  }
}
