"use client"

import { NativeSelect } from "@/components/native-select"
import { SetupNotice } from "@/components/setup-notice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatBRL, formatCompetence, monthKey } from "@/lib/format"
import { buildPlan, defaultActive, resolveKey, type PlanOptions } from "@/lib/planilha/plan"
import { checkMonths, isParsed, normName, parseTab, suggestMerges, type IgnoredTab, type ParsedTab } from "@/lib/planilha/parse"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Step = { label: string; state: "wait" | "run" | "ok" | "skip" | "err"; detail?: string }
const STORAGE = "geab.planilha.url"

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

export default function ImportPage() {
  const [url, setUrl] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [tabs, setTabs] = React.useState<ParsedTab[] | null>(null)
  const [ignored, setIgnored] = React.useState<IgnoredTab[]>([])
  const [alias, setAlias] = React.useState<Record<string, string>>({})
  const [exclude, setExclude] = React.useState<Record<string, boolean>>({})
  const [active, setActive] = React.useState<Record<string, boolean>>({})
  const [fee, setFee] = React.useState("100")
  const [dueDay, setDueDay] = React.useState("10")
  const [pendingFrom, setPendingFrom] = React.useState(monthKey())
  const [steps, setSteps] = React.useState<Step[] | null>(null)
  const [running, setRunning] = React.useState(false)
  const currentMonth = monthKey()

  React.useEffect(() => { try { setUrl(localStorage.getItem(STORAGE) ?? "") } catch {} }, [])

  async function read() {
    setLoading(true)
    setSteps(null)
    try {
      const res = await fetch("/api/planilha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim() }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? "Falha ao ler a planilha.")
      const parsed: ParsedTab[] = []
      const ign: IgnoredTab[] = []
      for (const t of body.tabs as { name: string; gid: string; csv: string }[]) {
        const r = parseTab(t.name, t.gid, t.csv)
        if (isParsed(r)) parsed.push(r)
        else ign.push(r)
      }
      const stats = new Map<string, number>()
      for (const t of parsed) for (const r of t.roster) stats.set(r.key, (stats.get(r.key) ?? 0) + 1)
      const sug = suggestMerges([...stats].map(([key, count]) => ({ key, count })))
      setAlias(Object.fromEntries(Object.entries(sug).filter(([, s]) => s.confidence === "alta").map(([k, s]) => [k, s.target])))
      setExclude(Object.fromEntries([...stats.keys()].filter((k) => k.includes("convidado")).map((k) => [k, true])))
      setActive({})
      setTabs(parsed)
      setIgnored(ign)
      try { localStorage.setItem(STORAGE, url.trim()) } catch {}
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }

  const feeN = Number(fee.replace(",", "."))
  const dueN = Number(dueDay)
  const optionsOk = Number.isFinite(feeN) && feeN > 0 && Number.isInteger(dueN) && dueN >= 1 && dueN <= 28

  const options: PlanOptions = { currentMonth, pendingFrom, fee: feeN, dueDay: dueN, alias, exclude, active }
  const plan = React.useMemo(() => (tabs && optionsOk ? buildPlan(tabs, options) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, alias, exclude, active, feeN, dueN, pendingFrom, optionsOk])

  const nameStats = React.useMemo(() => {
    if (!tabs) return []
    const m = new Map<string, { raws: Set<string>; count: number; paid: number }>()
    for (const t of tabs) for (const r of t.roster) {
      const e = m.get(r.key) ?? { raws: new Set<string>(), count: 0, paid: 0 }
      e.raws.add(r.nameRaw); e.count++
      if (r.value.kind === "num" && r.value.v > 0) e.paid++
      m.set(r.key, e)
    }
    return [...m].map(([key, v]) => ({ key, raws: [...v.raws], count: v.count, paid: v.paid })).sort((a, b) => b.count - a.count)
  }, [tabs])
  const suggestions = React.useMemo(() => suggestMerges(nameStats.map((n) => ({ key: n.key, count: n.count }))), [nameStats])
  const defaults = React.useMemo(() => (tabs ? defaultActive(tabs, currentMonth, alias) : new Set<string>()), [tabs, currentMonth, alias])
  const checks = React.useMemo(() => (tabs ? checkMonths(tabs) : []), [tabs])

  const setStep = (i: number, s: Partial<Step>) => setSteps((prev) => prev!.map((x, j) => (j === i ? { ...x, ...s } : x)))

  async function commit() {
    if (!plan) return
    const labels = ["Verificar o banco", "Atletas", "Mensalidades", "Pagamentos", "Despesas", "Ajuste de saldo"]
    setSteps(labels.map((label) => ({ label, state: "wait" })))
    setRunning(true)
    const sb = supabase()
    let i = 0
    try {
      // 0) pré-requisitos
      setStep(i, { state: "run" })
      const probe = await sb.from("other_income").select("id").limit(1)
      if (probe.error) throw new Error("A migração 0002 (outras entradas) ainda não foi aplicada no Supabase. Rode supabase/migrations/0002_other_income.sql no SQL Editor e tente de novo.")
      setStep(i, { state: "ok", detail: "ok" })

      // 1) atletas
      i = 1; setStep(i, { state: "run" })
      const existing = await fetchAll<{ id: string; full_name: string }>((a, b) => sb.from("athletes").select("id, full_name").range(a, b))
      const byName = new Map(existing.map((a) => [normName(a.full_name), a.id]))
      const ids = new Map<string, string>()
      const toCreate = plan.athletes.filter((a) => !byName.has(normName(a.fullName)))
      for (const a of plan.athletes) if (byName.has(normName(a.fullName))) ids.set(a.key, byName.get(normName(a.fullName))!)
      for (const part of chunk(toCreate, 100)) {
        const { data, error } = await sb.from("athletes").insert(part.map((a) => ({
          full_name: a.fullName, monthly_fee: feeN, due_day: dueN, active: a.active, joined_at: a.joinedAt,
        }))).select("id, full_name")
        if (error) throw new Error(`Atletas: ${error.message}`)
        for (const row of data!) { const a = part.find((p) => normName(p.fullName) === normName(row.full_name)); if (a) ids.set(a.key, row.id) }
      }
      setStep(i, { state: "ok", detail: `${toCreate.length} criados, ${plan.athletes.length - toCreate.length} já existiam` })

      // 2) mensalidades
      i = 2; setStep(i, { state: "run" })
      for (const part of chunk(plan.charges, 300)) {
        const { error } = await sb.from("charges").upsert(part.map((c) => ({
          athlete_id: ids.get(c.athleteKey)!, competence: c.competence, due_date: c.dueDate, amount: c.amount,
        })), { onConflict: "athlete_id,competence", ignoreDuplicates: true })
        if (error) throw new Error(`Mensalidades: ${error.message}`)
      }
      const allCharges = await fetchAll<{ id: string; athlete_id: string; competence: string }>((a, b) => sb.from("charges").select("id, athlete_id, competence").range(a, b))
      const chargeId = new Map(allCharges.map((c) => [`${c.athlete_id}|${c.competence}`, c.id]))
      setStep(i, { state: "ok", detail: `${plan.charges.length} no plano` })

      // 3) pagamentos
      i = 3; setStep(i, { state: "run" })
      const have = new Set((await fetchAll<{ bank_txid: string }>((a, b) => sb.from("payments").select("bank_txid").like("bank_txid", "planilha:%").range(a, b))).map((p) => p.bank_txid))
      const todo = plan.payments.filter((p) => !have.has(p.txid))
      let done = 0
      for (const part of chunk(todo, 100)) {
        const rows = part.map((p) => ({
          athlete_id: ids.get(p.athleteKey)!, charge_id: chargeId.get(`${ids.get(p.athleteKey)}|${p.competence}`)!,
          amount: p.amount, paid_at: p.paidAt, method: "outro", source: "manual", bank_txid: p.txid, notes: p.note,
        }))
        const { error } = await sb.from("payments").insert(rows)
        if (error) throw new Error(`Pagamentos (após ${done}): ${error.message}`)
        done += part.length
        setStep(i, { state: "run", detail: `${done}/${todo.length}` })
      }
      setStep(i, { state: "ok", detail: `${todo.length} gravados, ${plan.payments.length - todo.length} já existiam` })

      // 4) despesas (só na primeira importação)
      i = 4; setStep(i, { state: "run" })
      const exp = await sb.from("expenses").select("id", { count: "exact", head: true })
      if ((exp.count ?? 0) > 0) setStep(i, { state: "skip", detail: "já existem despesas cadastradas; não importei de novo para não duplicar" })
      else {
        for (const part of chunk(plan.expenses, 200)) {
          const { error } = await sb.from("expenses").insert(part.map((x) => ({ spent_at: x.spentAt, description: x.description, category: x.category, amount: x.amount })))
          if (error) throw new Error(`Despesas: ${error.message}`)
        }
        setStep(i, { state: "ok", detail: `${plan.expenses.length} gravadas` })
      }

      // 5) ajuste de saldo, para o caixa bater com o saldo da planilha no mês corrente
      i = 5; setStep(i, { state: "run" })
      const diff = plan.balance.diff
      const first = tabs!.map((t) => t.competence).sort()[0]
      const desc = `Ajuste de saldo da importação (entradas que não são mensalidade: patrocínios, uniformes, dinheiro e saldos anteriores) — iguala o caixa ao saldo da planilha em ${formatCompetence(plan.balance.month)}`
      const prior = await sb.from("other_income").select("id", { count: "exact", head: true }).like("description", "Ajuste de saldo da importação%")
      if (diff == null || Math.abs(diff) < 0.005) setStep(i, { state: "skip", detail: "o saldo já bate com a planilha" })
      else if ((prior.count ?? 0) > 0) setStep(i, { state: "skip", detail: "o ajuste já foi lançado antes" })
      else {
        const r = diff < 0
          ? await sb.from("other_income").insert({ received_at: first, description: desc, category: "Ajuste", amount: -diff })
          : await sb.from("expenses").insert({ spent_at: first, description: desc.replace("entradas que não são mensalidade", "diferença"), category: "Ajuste", amount: diff })
        if (r.error) throw new Error(`Ajuste: ${r.error.message}`)
        setStep(i, { state: "ok", detail: `${formatBRL(Math.abs(diff))} ${diff < 0 ? "em outras entradas" : "em despesas"}` })
      }
      toast.success("Importação concluída.")
    } catch (e) {
      setStep(i, { state: "err", detail: e instanceof Error ? e.message : String(e) })
      toast.error("A importação parou. Veja o erro na lista de etapas.")
    }
    setRunning(false)
  }

  if (!supabaseConfigured) return <SetupNotice />
  const badMonths = checks.filter((c) => c.depositsMatchTotal === false || c.expensesMatchTotal === false)
  const warnings = (tabs ?? []).flatMap((t) => t.warnings.map((w) => `${t.name}: ${w}`))
  const sideTabs = (tabs ?? []).filter((t) => t.sideRows.length)

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Importar da planilha</h1>
        <p className="text-sm text-muted-foreground">Lê a planilha publicada do GEAB (uma aba por mês), mostra uma prévia e só grava depois que você confirmar. A planilha original não é alterada.</p>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <Label htmlFor="u">Link da planilha publicada na web (termina em /pubhtml)</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="u" className="min-w-0 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/e/…/pubhtml" />
            <Button onClick={read} disabled={loading || !url.trim()}>{loading && <Loader2 className="animate-spin" />} Ler planilha</Button>
          </div>
        </CardContent>
      </Card>

      {tabs && plan && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Abas de mês lidas", String(tabs.length)],
              ["Atletas", String(plan.athletes.length)],
              ["Mensalidades", String(plan.charges.length)],
              ["Pagamentos", String(plan.payments.length)],
              ["Despesas", String(plan.expenses.length)],
            ].map(([l, v]) => (
              <Card key={l}><CardContent className="pt-4"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-semibold tabular-nums">{v}</div></CardContent></Card>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Como o histórico será tratado</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>Meses <b>anteriores</b> a “cobrar a partir de” viram <b>histórico</b>: a mensalidade tem o valor que foi de fato depositado (já paga). Nenhuma dívida antiga é inventada, porque o valor da mensalidade mudou ao longo dos anos.</li>
                <li>A partir do mês escolhido, todo jogador listado na aba ganha mensalidade de <b>{formatBRL(feeN || 0)}</b> com vencimento no dia {dueN || "—"}: quem pagou fica pago, os demais ficam pendentes.</li>
                <li>Linhas de “saldo anterior/restante” não são pagamento nem atleta. A forma de pagamento não consta na planilha, então os pagamentos entram como “outro”.</li>
              </ul>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1"><Label htmlFor="f">Mensalidade atual (R$)</Label><Input id="f" className="w-28" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="d">Dia do vencimento</Label><Input id="d" className="w-24" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="p">Cobrar a partir de</Label>
                  <NativeSelect id="p" value={pendingFrom} onChange={(e) => setPendingFrom(e.target.value)}>
                    {[...tabs].sort((a, b) => b.competence.localeCompare(a.competence)).filter((t) => t.competence <= currentMonth).slice(0, 12).map((t) => <option key={t.competence} value={t.competence}>{formatCompetence(t.competence)}</option>)}
                  </NativeSelect></div>
              </div>
              {!optionsOk && <p role="alert" className="text-destructive">Informe uma mensalidade maior que zero e um dia de vencimento entre 1 e 28.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Conferência com os totais da planilha</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="flex items-start gap-2">{badMonths.length === 0 ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-700" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                {badMonths.length === 0 ? "Depósitos e despesas de todas as abas batem com a linha TOTAL da própria planilha." : `Em ${badMonths.length} aba(s) a soma não bate com a linha TOTAL da planilha: ${badMonths.map((c) => c.tab).join(", ")}. É diferença na planilha, não no sistema.`}</p>
              <p className="flex items-start gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <span>Saldo da planilha em {formatCompetence(plan.balance.month)}: <b>{plan.balance.sheet != null ? formatBRL(plan.balance.sheet) : "—"}</b>. Só com mensalidades e despesas o sistema calcularia <b>{formatBRL(plan.balance.computed)}</b>. A diferença de <b>{plan.balance.diff != null ? formatBRL(Math.abs(plan.balance.diff)) : "—"}</b> são entradas que a planilha tem fora da coluna de depósitos (patrocínios, uniformes, dinheiro e saldos). Na importação ela entra como <b>um único lançamento de ajuste</b>, identificado, para o caixa começar igual ao saldo real.</span></p>
              {sideTabs.length > 0 && <details className="text-muted-foreground"><summary className="cursor-pointer">Blocos laterais não importados ({sideTabs.length} abas: patrocínio, uniforme, dinheiro, outros)</summary>
                <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-xs">{sideTabs.flatMap((t) => t.sideRows.map((r) => <li key={`${t.name}${r.row}`}>{t.name} · linha {r.row}: {r.cells.join(" · ")}</li>))}</ul></details>}
              {ignored.length > 0 && <p className="text-muted-foreground">Abas ignoradas: {ignored.map((i) => `${i.name} (${i.reason})`).join("; ")}.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Atletas encontrados</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">Os nomes da planilha são apelidos e têm erros de digitação. Já juntei os de erro óbvio (distância de uma letra); confira, e junte o que faltar em “Juntar com”. Desmarque “Importar” para deixar alguém de fora (os pagamentos dele também). Ativo = está na lista do mês atual.</p>
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-16">Importar</TableHead><TableHead>Nome na planilha</TableHead><TableHead className="text-right">Meses</TableHead><TableHead className="text-right">Pagou</TableHead><TableHead>Juntar com</TableHead><TableHead>Ativo</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {nameStats.map((n) => {
                      const root = resolveKey(n.key, alias)
                      const merged = root !== n.key
                      const sug = suggestions[n.key]
                      const effActive = merged ? undefined : (active[n.key] ?? defaults.has(n.key))
                      return (
                        <TableRow key={n.key} className={merged ? "bg-muted/40" : undefined}>
                          <TableCell><Checkbox checked={!exclude[root]} disabled={merged} onCheckedChange={(v) => setExclude((p) => ({ ...p, [root]: !v }))} aria-label={`Importar ${n.raws[0]}`} /></TableCell>
                          <TableCell><span className="font-medium">{n.raws[0]}</span>{n.raws.length > 1 && <span className="ml-1 text-xs text-muted-foreground">({n.raws.slice(1).join(", ")})</span>}</TableCell>
                          <TableCell className="text-right tabular-nums">{n.count}</TableCell>
                          <TableCell className="text-right tabular-nums">{n.paid}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <NativeSelect value={alias[n.key] ?? ""} onChange={(e) => setAlias((p) => { const c = { ...p }; if (e.target.value) c[n.key] = e.target.value; else delete c[n.key]; return c })} aria-label={`Juntar ${n.raws[0]} com`} className="max-w-40">
                                <option value="">— separado —</option>
                                {nameStats.filter((o) => o.key !== n.key && resolveKey(o.key, alias) !== n.key).map((o) => <option key={o.key} value={o.key}>{o.raws[0]}</option>)}
                              </NativeSelect>
                              {sug && sug.confidence === "media" && alias[n.key] !== sug.target && (
                                <Button size="xs" variant="outline" onClick={() => setAlias((p) => ({ ...p, [n.key]: sug.target }))}>Sugestão: {nameStats.find((o) => o.key === sug.target)?.raws[0]}</Button>
                              )}
                              {sug && sug.confidence === "alta" && merged && alias[n.key] === sug.target && <Badge variant="outline" className="text-[10px]">auto</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>{effActive === undefined ? "—" : <Switch checked={effActive} onCheckedChange={(v) => setActive((p) => ({ ...p, [n.key]: v }))} aria-label={`Ativo: ${n.raws[0]}`} />}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {warnings.length > 0 && (
            <details className="rounded-xl border bg-card p-4 text-sm">
              <summary className="cursor-pointer font-medium">{warnings.length} aviso(s) da leitura (datas faltando, valores ilegíveis…)</summary>
              <ul className="mt-2 max-h-56 space-y-0.5 overflow-auto text-xs text-muted-foreground">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}

          <Card>
            <CardContent className="space-y-3 pt-4">
              <p className="text-sm">Vai gravar <b>{plan.athletes.length}</b> atletas ({plan.athletes.filter((a) => a.active).length} ativos), <b>{plan.charges.length}</b> mensalidades, <b>{plan.payments.length}</b> pagamentos e <b>{plan.expenses.length}</b> despesas. Pode rodar de novo sem duplicar atletas, mensalidades ou pagamentos.</p>
              <Button onClick={commit} disabled={running || !optionsOk}>{running && <Loader2 className="animate-spin" />} Importar agora</Button>
              {steps && (
                <ol className="space-y-1 text-sm">
                  {steps.map((s) => (
                    <li key={s.label} className="flex items-start gap-2">
                      <span className="w-5 shrink-0 text-center">{s.state === "ok" ? "✅" : s.state === "run" ? "⏳" : s.state === "err" ? "❌" : s.state === "skip" ? "⏭️" : "·"}</span>
                      <span><b>{s.label}</b>{s.detail && <span className={s.state === "err" ? "text-destructive" : "text-muted-foreground"}> — {s.detail}</span>}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}
