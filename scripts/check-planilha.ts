// Verifica o leitor da planilha contra CSVs das abas (uma pasta com arquivos NN_nome.csv).
// Uso: npx tsx scripts/check-planilha.ts <pasta-com-csvs> [mês-corrente AAAA-MM-01]
import fs from "node:fs"
import path from "node:path"
import { checkMonths, isParsed, parseTab, suggestMerges, type ParsedTab } from "../src/lib/planilha/parse"
import { buildPlan } from "../src/lib/planilha/plan"

const dir = process.argv[2]
const currentMonth = process.argv[3] ?? "2026-11-01"
const parsed: ParsedTab[] = []
const ignored: { name: string; reason: string }[] = []
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".csv")).sort()) {
  const name = f.replace(/^\d+_/, "").replace(/\.csv$/, "")
  const r = parseTab(name, f.slice(0, 2), fs.readFileSync(path.join(dir, f), "utf8"))
  if (isParsed(r)) parsed.push(r)
  else ignored.push({ name: r.name, reason: r.reason })
}
let bad = 0
const ok = (n: string, c: boolean, x = "") => { console.log(c ? "PASS" : "FAIL", n, x); if (!c) bad++ }

ok("abas de mês lidas", parsed.length === 55, `lidas=${parsed.length}`)
ok("abas ignoradas = Página47 e FESTA_23", ignored.map((i) => i.name).sort().join(",") === "FESTA_23,Página47", JSON.stringify(ignored))
const checks = checkMonths(parsed)
const noDeposit = checks.filter((c) => c.depositsMatchTotal === false)
const noExpense = checks.filter((c) => c.expensesMatchTotal === false)
ok("depósitos batem com a linha TOTAL em todas as abas (exceto erros da planilha)", noDeposit.length <= 1, noDeposit.map((c) => `${c.tab}(${c.carryOver}+${c.deposits})`).join(" "))
ok("despesas batem com a linha TOTAL em todas as abas", noExpense.length === 0, noExpense.map((c) => c.tab).join(","))

const plan = buildPlan(parsed, { currentMonth, pendingFrom: currentMonth, fee: 100, dueDay: 10, alias: {}, exclude: {}, active: {} })
console.log(`\nSem junções: ${plan.athletes.length} atletas, ${plan.charges.length} mensalidades, ${plan.payments.length} pagamentos, ${plan.expenses.length} despesas`)
console.log("Saldo calculado até", plan.balance.month, "=", plan.balance.computed, "| planilha =", plan.balance.sheet, "| diferença =", plan.balance.diff)
ok("diferença de saldo é conhecida (entradas que não são mensalidade)", plan.balance.diff != null, `diff=${plan.balance.diff}`)

const cur = plan.charges.filter((c) => c.competence === currentMonth)
ok("mês corrente: 15 atletas distintos (16 linhas, 1 nome repetido), todos com R$ 100", cur.length === 15 && cur.every((c) => c.amount === 100), `n=${cur.length}`)
const curPaid = plan.payments.filter((p) => p.competence === currentMonth)
ok("mês corrente: 1 pagamento de R$ 100 (Rogerio)", curPaid.length === 1 && curPaid[0].amount === 100, JSON.stringify(curPaid.map((p) => [p.athleteKey, p.amount, p.paidAt])))
const fut = plan.charges.filter((c) => c.competence > currentMonth)
ok("mês futuro (dez/26): só quem já pagou, 1 mensalidade", fut.length === 1 && fut[0].amount === 100, `n=${fut.length}`)
const hist = plan.charges.filter((c) => c.competence < currentMonth)
ok("histórico: toda mensalidade tem valor igual ao pago", hist.every((c) => c.kind === "historico" && c.amount === Math.round(plan.payments.filter((p) => p.athleteKey === c.athleteKey && p.competence === c.competence).reduce((s, p) => s + p.amount, 0) * 100) / 100))
ok("txids de pagamento são únicos", new Set(plan.payments.map((p) => p.txid)).size === plan.payments.length)
ok("nenhum 'saldo anterior' virou atleta", !plan.athletes.some((a) => /saldo|restante|sobra/.test(a.key)), plan.athletes.filter((a) => /saldo|restante|sobra/.test(a.key)).map((a) => a.key).join(","))

const stats = new Map<string, number>()
for (const t of parsed) for (const r of t.roster) stats.set(r.key, (stats.get(r.key) ?? 0) + 1)
const sug = suggestMerges([...stats].map(([key, count]) => ({ key, count })))
const alta = Object.entries(sug).filter(([, s]) => s.confidence === "alta")
const media = Object.entries(sug).filter(([, s]) => s.confidence === "media")
console.log(`\nSugestões de junção: ${alta.length} altas, ${media.length} médias`)
for (const [k, s] of alta) console.log(`  alta  ${k} → ${s.target}`)
for (const [k, s] of media) console.log(`  média ${k} → ${s.target}`)
const alias = Object.fromEntries(alta.map(([k, s]) => [k, s.target]))
const planM = buildPlan(parsed, { currentMonth, pendingFrom: currentMonth, fee: 100, dueDay: 10, alias, exclude: {}, active: {} })
console.log(`\nCom as junções altas: ${planM.athletes.length} atletas (${planM.athletes.filter((a) => a.active).length} ativos)`)
ok("junções não mudam o saldo", planM.balance.diff === plan.balance.diff)
ok("junções não mudam a quantidade de pagamentos", planM.payments.length === plan.payments.length)
console.log("\nAtivos:", planM.athletes.filter((a) => a.active).map((a) => a.fullName).join(", "))
console.log("\nAvisos (", parsed.reduce((s, t) => s + t.warnings.length, 0), "):")
for (const t of parsed) for (const w of t.warnings.slice(0, 2)) console.log("  ", t.name, "-", w)
console.log("\nBlocos laterais não importados:", parsed.filter((t) => t.sideRows.length).length, "abas")
process.exit(bad ? 1 : 0)
