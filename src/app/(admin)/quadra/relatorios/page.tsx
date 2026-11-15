"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { sportLabel, useCourtRoleCtx } from "@/hooks/use-court-role"
import { useLoad } from "@/hooks/use-load"
import { KIND_LABEL, PAY_METHODS } from "@/lib/court-booking"
import { downloadCsv, fmtHours, fmtPct, moneyCsv, pct, printPdf, type Table } from "@/lib/court-report"
import { addDays, fmtDateBR, MONTHS, todayIn, WEEKDAYS } from "@/lib/court-time"
import { formatBRL } from "@/lib/format"
import { supabase } from "@/lib/supabase/client"
import { Download, FileText } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Occ = { by_court: { court: string; open_min: number; booked_min: number; blocked_min: number }[]; by_weekday: { weekday: number; open_min: number; booked_min: number }[]; by_hour: { hour: number; n: number; minutes: number }[]; by_sport: { sport: string; n: number }[]; by_kind: { kind: string; n: number }[] } | null
type Fin = { received: number; received_prev: number; billed: number; pending: number; overdue: number; overdue_clients: { client: string; cents: number; n: number }[]; by_month: { month: string; cents: number }[]; by_method: { method: string; cents: number }[]; summary: { by_court: { name: string; cents: number }[]; by_sport: { sport: string; cents: number }[]; by_kind: { kind: string; cents: number }[] } }
type Cli = { new_clients: number; registered_active: number; active_in_period: number; monthly_clients: number; recurrent: number; unlinked_bookings: number; top: { client: string; type: string; n: number; cents: number }[]; by_type: { type: string; n: number }[] }
const typeLabel: Record<string, string> = { avulso: "Avulso", mensalista: "Mensalista", professor: "Professor", organizador: "Organizador", outros: "Outros" }
const methodLabel = (m: string) => PAY_METHODS.find(([k]) => k === m)?.[1] ?? m
const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]}/${d.slice(0, 4)}`

async function load(role: string, from: string, to: string) {
  const sb = supabase()
  const wantOps = role === "admin" || role === "gerente", wantFin = wantOps || role === "financeiro"
  const [o, f, c, v] = await Promise.all([
    wantOps ? sb.rpc("court_report_occupancy", { p_from: from, p_to: to }) : null,
    wantFin ? sb.rpc("court_report_finance", { p_from: from, p_to: to }) : null,
    wantOps ? sb.rpc("court_report_clients", { p_from: from, p_to: to }) : null,
    sb.from("court_venues").select("trade_name").maybeSingle(),
  ])
  for (const x of [o, f, c]) if (x?.error) throw new Error(x.error.message)
  return { occ: (o?.data ?? null) as Occ, fin: (f?.data ?? null) as Fin | null, cli: (c?.data ?? null) as Cli | null, venue: (v.data?.trade_name as string | undefined) ?? "Centro esportivo" }
}

export default function RelatoriosPage() {
  const role = useCourtRoleCtx()!
  const t0 = React.useMemo(() => todayIn("America/Sao_Paulo"), [])
  const [p, setP] = React.useState({ from: addDays(t0, -89), to: t0 })
  const allowed = role === "admin" || role === "gerente" || role === "financeiro"
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000)
  const invalid = days < 0 || days > 400
  const { data, error, loading } = useLoad(() => (allowed && !invalid ? load(role, p.from, p.to) : Promise.resolve(null)), [role, p.from, p.to, allowed, invalid])
  if (!allowed) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">O seu perfil não acessa os relatórios.</p>
  const ops = role === "admin" || role === "gerente"
  const preset = (n: number) => <Button variant="outline" onClick={() => setP({ from: addDays(t0, -n + 1), to: t0 })}>{n === 90 ? "3 meses" : n === 180 ? "6 meses" : "1 ano"}</Button>

  const tables = (kind: "occ" | "fin" | "cli"): Table[] => {
    if (!data) return []
    if (kind === "occ" && data.occ) return [
      { title: "Ocupação por quadra", head: ["Quadra", "Horas disponíveis", "Horas ocupadas", "Horas bloqueadas", "Taxa de ocupação"], rows: data.occ.by_court.map((c) => [c.court, fmtHours(c.open_min), fmtHours(c.booked_min), fmtHours(c.blocked_min), fmtPct(pct(c.booked_min, c.open_min))]) },
      { title: "Ocupação por dia da semana", head: ["Dia", "Horas disponíveis", "Horas ocupadas", "Taxa"], rows: data.occ.by_weekday.map((w) => [WEEKDAYS[w.weekday], fmtHours(w.open_min), fmtHours(w.booked_min), fmtPct(pct(w.booked_min, w.open_min))]) },
      { title: "Reservas por faixa de horário", head: ["Horário", "Reservas", "Horas"], rows: data.occ.by_hour.map((h) => [`${String(h.hour).padStart(2, "0")}h`, h.n, fmtHours(h.minutes)]) },
      { title: "Reservas por modalidade", head: ["Modalidade", "Reservas"], rows: data.occ.by_sport.map((s) => [sportLabel(s.sport), s.n]) },
      { title: "Reservas por categoria", head: ["Categoria", "Reservas"], rows: data.occ.by_kind.map((k) => [KIND_LABEL[k.kind as keyof typeof KIND_LABEL] ?? k.kind, k.n]) },
    ]
    if (kind === "fin" && data.fin) { const f = data.fin; return [
      { title: "Resumo financeiro", head: ["Indicador", "Valor (R$)"], rows: [["Recebido no período", moneyCsv(f.received)], ["Recebido no período anterior (mesma duração)", moneyCsv(f.received_prev)], ["Cobrado (vencimentos no período)", moneyCsv(f.billed)], ["Pendente a vencer", moneyCsv(f.pending)], ["Em atraso (inadimplência)", moneyCsv(f.overdue)]] },
      { title: "Receita por mês", head: ["Mês", "Recebido (R$)"], rows: f.by_month.map((m) => [monthLabel(m.month), moneyCsv(m.cents)]) },
      { title: "Receita por quadra", head: ["Quadra", "Recebido (R$)"], rows: f.summary.by_court.map((x) => [x.name, moneyCsv(x.cents)]) },
      { title: "Receita por forma de pagamento", head: ["Forma", "Recebido (R$)"], rows: f.by_method.map((x) => [methodLabel(x.method), moneyCsv(x.cents)]) },
      { title: "Inadimplência por cliente", head: ["Cliente", "Lançamentos", "Em atraso (R$)"], rows: f.overdue_clients.map((x) => [x.client, x.n, moneyCsv(x.cents)]) },
    ] }
    if (kind === "cli" && data.cli) { const c = data.cli; return [
      { title: "Clientes", head: ["Indicador", "Quantidade"], rows: [["Novos clientes no período", c.new_clients], ["Clientes cadastrados ativos", c.registered_active], ["Clientes com reserva no período", c.active_in_period], ["Mensalistas ativos", c.monthly_clients], ["Clientes recorrentes (4 ou mais reservas)", c.recurrent], ["Reservas sem cliente cadastrado", c.unlinked_bookings]] },
      { title: "Clientes que mais reservam", head: ["Cliente", "Tipo", "Reservas", "Valor (R$)"], rows: c.top.map((x) => [x.client, typeLabel[x.type] ?? x.type, x.n, moneyCsv(x.cents)]) },
    ] }
    return []
  }
  const sub = `${data?.venue ?? ""} · período de ${fmtDateBR(p.from)} a ${fmtDateBR(p.to)}`
  const exp = (kind: "occ" | "fin" | "cli", name: string, how: "csv" | "pdf") => {
    const t = tables(kind)
    if (!t.length) return toast.error("Sem dados para exportar.")
    if (how === "csv") downloadCsv(`relatorio-${name.toLowerCase()}-${p.from}_${p.to}.csv`, t)
    else if (!printPdf(`Relatório de ${name}`, sub, t)) toast.error("O navegador bloqueou a janela de impressão. Libere pop-ups para este site.")
  }
  const bar = (v: number) => <span className="inline-block h-2 rounded bg-primary align-middle" style={{ width: `${Math.max(2, Math.min(100, v))}%` }} />
  const ExportBtns = ({ kind, name }: { kind: "occ" | "fin" | "cli"; name: string }) => <div className="flex gap-2"><Button variant="outline" onClick={() => exp(kind, name, "csv")}><Download className="size-4" /> Excel</Button><Button variant="outline" onClick={() => exp(kind, name, "pdf")}><FileText className="size-4" /> PDF</Button></div>
  const diff = data?.fin ? (data.fin.received_prev > 0 ? pct(data.fin.received - data.fin.received_prev, data.fin.received_prev) : null) : null

  return (
    <>
      <div><h1 className="text-xl font-semibold">Relatórios</h1><p className="text-sm text-muted-foreground">Calculados a partir das reservas, clientes e pagamentos reais do seu estabelecimento.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label htmlFor="rf">De</Label><Input id="rf" type="date" value={p.from} max={p.to} onChange={(e) => e.target.value && setP({ ...p, from: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="rt">Até</Label><Input id="rt" type="date" value={p.to} min={p.from} onChange={(e) => e.target.value && setP({ ...p, to: e.target.value })} /></div>
        {preset(90)}{preset(180)}{preset(365)}
      </div>
      {invalid && <p role="alert" className="text-sm text-destructive">Período inválido: escolha de 1 dia até 13 meses.</p>}
      {error && <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>}
      {loading && !data ? <Skeleton className="h-72" /> : data && (
        <Tabs defaultValue={ops ? "occ" : "fin"}>
          <TabsList>{ops && <TabsTrigger value="occ">Ocupação</TabsTrigger>}<TabsTrigger value="fin">Financeiro</TabsTrigger>{ops && <TabsTrigger value="cli">Clientes</TabsTrigger>}</TabsList>

          {ops && data.occ && <TabsContent value="occ" className="space-y-3">
            <div className="flex justify-end"><ExportBtns kind="occ" name="Ocupação" /></div>
            <Card className="overflow-x-auto p-4"><h2 className="mb-2 text-sm font-semibold">Por quadra</h2><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Quadra</th><th>Disponíveis</th><th>Ocupadas</th><th>Bloqueadas</th><th className="w-40">Taxa</th></tr></thead><tbody>
              {data.occ.by_court.map((c) => <tr key={c.court} className="border-t"><td className="py-1.5">{c.court}</td><td>{fmtHours(c.open_min)}</td><td>{fmtHours(c.booked_min)}</td><td>{fmtHours(c.blocked_min)}</td><td>{bar(pct(c.booked_min, c.open_min))} {fmtPct(pct(c.booked_min, c.open_min))}</td></tr>)}
              {data.occ.by_court.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">Sem quadras ativas.</td></tr>}</tbody></table></Card>
            <div className="grid gap-3 md:grid-cols-2">
              <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">Por dia da semana</h2><ul className="space-y-1 text-sm">{data.occ.by_weekday.map((w) => <li key={w.weekday} className="flex items-center justify-between gap-2"><span className="w-24">{WEEKDAYS[w.weekday]}</span><span className="flex-1">{bar(pct(w.booked_min, w.open_min))}</span><span className="w-14 text-right tabular-nums">{fmtPct(pct(w.booked_min, w.open_min))}</span></li>)}</ul></Card>
              <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">Por faixa de horário</h2><ul className="space-y-1 text-sm">{data.occ.by_hour.map((h) => <li key={h.hour} className="flex justify-between gap-2"><span>{String(h.hour).padStart(2, "0")}h</span><span className="tabular-nums">{h.n} reserva(s) · {fmtHours(h.minutes)}</span></li>)}{data.occ.by_hour.length === 0 && <li className="text-muted-foreground">Sem reservas no período.</li>}</ul></Card>
              <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">Por modalidade</h2><ul className="space-y-1 text-sm">{data.occ.by_sport.map((s) => <li key={s.sport} className="flex justify-between"><span>{sportLabel(s.sport)}</span><span className="tabular-nums">{s.n}</span></li>)}{data.occ.by_sport.length === 0 && <li className="text-muted-foreground">Sem reservas no período.</li>}</ul></Card>
              <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">Por categoria</h2><ul className="space-y-1 text-sm">{data.occ.by_kind.map((k) => <li key={k.kind} className="flex justify-between"><span>{KIND_LABEL[k.kind as keyof typeof KIND_LABEL] ?? k.kind}</span><span className="tabular-nums">{k.n}</span></li>)}{data.occ.by_kind.length === 0 && <li className="text-muted-foreground">Sem reservas no período.</li>}</ul></Card>
            </div>
          </TabsContent>}

          {data.fin && <TabsContent value="fin" className="space-y-3">
            <div className="flex justify-end"><ExportBtns kind="fin" name="Financeiro" /></div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[["Recebido no período", formatBRL(data.fin.received / 100), diff == null ? "sem período anterior para comparar" : `${diff >= 0 ? "+" : ""}${fmtPct(diff)} vs. período anterior (${formatBRL(data.fin.received_prev / 100)})`], ["Cobrado no período", formatBRL(data.fin.billed / 100), "vencimentos no período"], ["Pendente a vencer", formatBRL(data.fin.pending / 100), ""], ["Inadimplência", formatBRL(data.fin.overdue / 100), "em atraso hoje"]].map(([l, v, s]) => <Card key={l} className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="text-xl font-semibold tabular-nums">{v}</p><p className="text-xs text-muted-foreground">{s}</p></Card>)}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">Receita por mês</h2><ul className="space-y-1 text-sm">{data.fin.by_month.map((m) => <li key={m.month} className="flex justify-between"><span>{monthLabel(m.month)}</span><span className="tabular-nums">{formatBRL(m.cents / 100)}</span></li>)}{data.fin.by_month.length === 0 && <li className="text-muted-foreground">Sem recebimentos no período.</li>}</ul></Card>
              <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">Receita por quadra</h2><ul className="space-y-1 text-sm">{data.fin.summary.by_court.map((x) => <li key={x.name} className="flex justify-between"><span>{x.name}</span><span className="tabular-nums">{formatBRL(x.cents / 100)}</span></li>)}{data.fin.summary.by_court.length === 0 && <li className="text-muted-foreground">Sem dados no período.</li>}</ul></Card>
              <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">Por forma de pagamento</h2><ul className="space-y-1 text-sm">{data.fin.by_method.map((x) => <li key={x.method} className="flex justify-between"><span>{methodLabel(x.method)}</span><span className="tabular-nums">{formatBRL(x.cents / 100)}</span></li>)}{data.fin.by_method.length === 0 && <li className="text-muted-foreground">Sem dados no período.</li>}</ul></Card>
              <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">Inadimplência por cliente</h2><ul className="space-y-1 text-sm">{data.fin.overdue_clients.map((x) => <li key={x.client} className="flex justify-between"><span>{x.client} <span className="text-xs text-muted-foreground">({x.n})</span></span><span className="tabular-nums">{formatBRL(x.cents / 100)}</span></li>)}{data.fin.overdue_clients.length === 0 && <li className="text-muted-foreground">Nenhum valor em atraso.</li>}</ul></Card>
            </div>
          </TabsContent>}

          {ops && data.cli && <TabsContent value="cli" className="space-y-3">
            <div className="flex justify-end"><ExportBtns kind="cli" name="Clientes" /></div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[["Novos no período", data.cli.new_clients], ["Cadastrados ativos", data.cli.registered_active], ["Com reserva no período", data.cli.active_in_period], ["Mensalistas", data.cli.monthly_clients], ["Recorrentes (4+ reservas)", data.cli.recurrent]].map(([l, v]) => <Card key={l} className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="text-xl font-semibold tabular-nums">{v}</p></Card>)}
            </div>
            {data.cli.unlinked_bookings > 0 && <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{data.cli.unlinked_bookings} reserva(s) do período não estão ligadas a um cliente cadastrado (sem telefone ou telefone não cadastrado); elas não entram na frequência por cliente.</p>}
            <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">Clientes que mais reservam</h2><ul className="divide-y text-sm">{data.cli.top.map((x) => <li key={x.client} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{x.client} <span className="text-xs text-muted-foreground">{typeLabel[x.type] ?? x.type}</span></span><span className="tabular-nums">{x.n} reserva(s) · {formatBRL(x.cents / 100)}</span></li>)}{data.cli.top.length === 0 && <li className="py-2 text-muted-foreground">Sem reservas de clientes cadastrados no período.</li>}</ul></Card>
          </TabsContent>}
        </Tabs>
      )}
    </>
  )
}
