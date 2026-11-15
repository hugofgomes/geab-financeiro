"use client"

import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { sportLabel, useCourtRoleCtx } from "@/hooks/use-court-role"
import { useLoad } from "@/hooks/use-load"
import { KIND_LABEL, PAY_METHODS } from "@/lib/court-booking"
import { addDays, fmtDateBR, todayIn } from "@/lib/court-time"
import { formatBRL } from "@/lib/format"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Download, Loader2, Plus } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Rec = {
  id: string; code: string; client_id: string | null; client_name: string | null; booking_id: string | null; series_id: string | null; description: string; issued_on: string; due_on: string
  amount_cents: number; paid_cents: number; payment_method: string | null; status: "aberto" | "parcial" | "pago" | "cancelado"; notes: string | null; cancel_reason: string | null
  booking: { court_id: string; code: string } | null
}
type Pay = { id: string; amount_cents: number; method: string; paid_on: string; note: string | null; created_at: string }
type Summary = { to_receive: number; overdue: number; overdue_count: number; received: number; by_court: { name: string; cents: number }[]; by_sport: { sport: string; cents: number }[]; by_kind: { kind: string; cents: number }[] }
type Ref = { courts: { id: string; name: string }[]; series: { id: string; client_name: string }[]; tz: string }
type View = Rec & { view: "aberto" | "parcial" | "pago" | "cancelado" | "vencido" }
const VIEW_LABEL = { aberto: "Em aberto", parcial: "Parcialmente pago", pago: "Pago", vencido: "Vencido", cancelado: "Cancelado" } as const
const VIEW_CLS: Record<string, string> = { aberto: "bg-amber-100 text-amber-900", parcial: "bg-sky-100 text-sky-900", pago: "bg-green-100 text-green-900", vencido: "bg-red-100 text-red-900", cancelado: "bg-slate-200 text-slate-700" }
const methodLabel = (m: string | null) => PAY_METHODS.find(([k]) => k === m)?.[1] ?? "—"
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
const toCents = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100)
const centsToInput = (c: number) => (c / 100).toFixed(2).replace(".", ",")

async function load(from: string, to: string, allowed: boolean) {
  if (!allowed) return null
  const sb = supabase()
  const [r, s, c, se, v] = await Promise.all([
    sb.from("court_receivables").select("*, booking:court_bookings(court_id, code)").order("due_on", { ascending: false }).limit(3000),
    sb.rpc("court_finance_summary", { p_from: from, p_to: to }),
    sb.from("court_courts").select("id, name").order("name"),
    sb.from("court_series").select("id, client_name").order("created_at", { ascending: false }).limit(300),
    sb.from("court_venues").select("timezone").maybeSingle(),
  ])
  for (const x of [r, s, c, se]) if (x.error) throw new Error(x.error.message)
  return { recs: (r.data ?? []) as Rec[], sum: s.data as Summary, ref: { courts: c.data ?? [], series: se.data ?? [], tz: (v.data?.timezone as string | undefined) ?? "America/Sao_Paulo" } as Ref }
}

export default function FinanceiroPage() {
  const role = useCourtRoleCtx()!
  const allowed = role === "admin" || role === "gerente" || role === "financeiro"
  const [tzGuess] = React.useState("America/Sao_Paulo")
  const t0 = todayIn(tzGuess)
  const [period, setPeriod] = React.useState({ from: t0.slice(0, 8) + "01", to: t0 })
  const { data, error, loading, reload } = useLoad(() => load(period.from, period.to, allowed), [period.from, period.to, allowed])
  const [f, setF] = React.useState({ q: "", status: "", court: "", dueFrom: "", dueTo: "" })
  const [form, setForm] = React.useState<Rec | "novo" | null>(null)
  const [pay, setPay] = React.useState<Rec | null>(null)
  const [hist, setHist] = React.useState<Rec | null>(null)
  const [monthly, setMonthly] = React.useState(false)
  if (!allowed) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">O seu perfil não acessa o financeiro.</p>
  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading && !data) return <Skeleton className="h-72" />
  if (!data) return null
  const { recs, sum, ref } = data
  const today = todayIn(ref.tz)
  const courtName = new Map(ref.courts.map((c) => [c.id, c.name]))
  const views: View[] = recs.map((r) => ({ ...r, view: (r.status === "aberto" || r.status === "parcial") && r.due_on < today ? "vencido" : r.status }))
  const q = norm(f.q)
  const rows = views.filter((r) => (!f.status || r.view === f.status) && (!f.court || r.booking?.court_id === f.court) && (!f.dueFrom || r.due_on >= f.dueFrom) && (!f.dueTo || r.due_on <= f.dueTo) && (!q || norm(r.client_name ?? "").includes(q) || norm(r.code).includes(q) || norm(r.description).includes(q)))
  const canWrite = true

  function exportCsv() {
    const esc = (v: string | number) => { const s = String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const head = ["Código", "Cliente", "Reserva", "Descrição", "Emissão", "Vencimento", "Valor total", "Valor pago", "Saldo", "Forma de pagamento", "Status"]
    const lines = rows.map((r) => [r.code, r.client_name ?? "", r.booking?.code ?? "", r.description, fmtDateBR(r.issued_on), fmtDateBR(r.due_on), centsToInput(r.amount_cents), centsToInput(r.paid_cents), centsToInput(r.amount_cents - r.paid_cents), methodLabel(r.payment_method), VIEW_LABEL[r.view]].map(esc).join(";"))
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + [head.join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" })); a.download = `contas-a-receber-${today}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
  async function cancel(r: Rec) {
    const reason = window.prompt(`Cancelar o lançamento ${r.code}? Informe o motivo (o registro é mantido):`)
    if (reason === null) return
    const x = await supabase().rpc("court_receivable_cancel", { p_id: r.id, p_reason: reason }); if (x.error) toast.error(x.error.message); else { toast.success("Lançamento cancelado."); reload() }
  }
  const overdueRows = views.filter((r) => r.view === "vencido")
  const byClient = [...overdueRows.reduce((m, r) => m.set(r.client_name ?? "—", (m.get(r.client_name ?? "—") ?? 0) + r.amount_cents - r.paid_cents), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 5)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-xl font-semibold">Financeiro</h1><p className="text-sm text-muted-foreground">Contas a receber das reservas e mensalidades. Lançamentos e pagamentos nunca são apagados.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}><Download className="size-4" /> Exportar (Excel)</Button>
          {canWrite && <Button variant="outline" onClick={() => setMonthly(true)}>Gerar mensalidade</Button>}
          {canWrite && <Button onClick={() => setForm("novo")}><Plus className="size-4" /> Novo lançamento</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label htmlFor="pf">Recebido de</Label><Input id="pf" type="date" value={period.from} onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="pt">até</Label><Input id="pt" type="date" value={period.to} onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })} /></div>
        <Button variant="outline" onClick={() => setPeriod({ from: addDays(today, -89), to: today })}>Últimos 3 meses</Button>
        <Button variant="outline" onClick={() => setPeriod({ from: today.slice(0, 8) + "01", to: today })}>Este mês</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total a receber" value={formatBRL(sum.to_receive / 100)} />
        <Stat label="Em atraso" value={formatBRL(sum.overdue / 100)} sub={`${sum.overdue_count} lançamento(s)`} tone="bad" />
        <Stat label="Recebido no período" value={formatBRL(sum.received / 100)} tone="good" />
        <Stat label="Lançamentos" value={String(views.filter((r) => r.view !== "cancelado").length)} sub="não cancelados" />
      </div>
      <div className="grid gap-3 lg:grid-cols-4">
        <Breakdown title="Receita por quadra" rows={sum.by_court.map((x) => [x.name, x.cents])} />
        <Breakdown title="Receita por modalidade" rows={sum.by_sport.map((x) => [sportLabel(x.sport), x.cents])} />
        <Breakdown title="Receita por categoria" rows={sum.by_kind.map((x) => [KIND_LABEL[x.kind as keyof typeof KIND_LABEL] ?? x.kind, x.cents])} />
        <Breakdown title="Inadimplência por cliente" rows={byClient} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input aria-label="Buscar" placeholder="Cliente, código ou descrição" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <NativeSelect aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Todos os status</option>{Object.entries(VIEW_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
        <NativeSelect aria-label="Quadra" value={f.court} onChange={(e) => setF({ ...f, court: e.target.value })}><option value="">Todas as quadras</option>{ref.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        <Input aria-label="Vencimento de" type="date" value={f.dueFrom} onChange={(e) => setF({ ...f, dueFrom: e.target.value })} />
        <Input aria-label="Vencimento até" type="date" value={f.dueTo} onChange={(e) => setF({ ...f, dueTo: e.target.value })} />
      </div>
      <p className="text-sm text-muted-foreground">{rows.length} lançamento(s)</p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{r.client_name} <span className="font-mono text-xs font-normal text-muted-foreground">{r.code}</span> <span className={cn("ml-1 rounded-full px-2 py-0.5 text-xs font-medium", VIEW_CLS[r.view])}>{VIEW_LABEL[r.view]}</span></p>
                <p className="text-sm">{r.description}{r.booking && <span className="text-muted-foreground"> · {r.booking.code} · {courtName.get(r.booking.court_id)}</span>}</p>
                <p className="text-xs text-muted-foreground">Emissão {fmtDateBR(r.issued_on)} · vence {fmtDateBR(r.due_on)} · {methodLabel(r.payment_method)}{r.notes && ` · ${r.notes}`}</p>
              </div>
              <div className="text-right text-sm"><p className="font-semibold tabular-nums">{formatBRL(r.amount_cents / 100)}</p><p className="text-xs text-muted-foreground">pago {formatBRL(r.paid_cents / 100)} · saldo {formatBRL((r.amount_cents - r.paid_cents) / 100)}</p></div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(r.status === "aberto" || r.status === "parcial") && <Button size="sm" onClick={() => setPay(r)}>Registrar pagamento</Button>}
              {r.status !== "cancelado" && <Button size="sm" variant="outline" onClick={() => setForm(r)}>Editar</Button>}
              <Button size="sm" variant="outline" onClick={() => setHist(r)}>Histórico</Button>
              {r.status !== "cancelado" && r.paid_cents === 0 && <Button size="sm" variant="outline" className="text-destructive" onClick={() => cancel(r)}>Cancelar</Button>}
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum lançamento encontrado.</li>}
      </ul>

      <ReceivableForm key={form === "novo" ? "novo" : (form as Rec | null)?.id ?? "x"} open={!!form} rec={form === "novo" ? null : form} today={today} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload() }} />
      <PayDialog rec={pay} today={today} onClose={() => setPay(null)} onSaved={() => { setPay(null); reload() }} />
      <HistoryDialog rec={hist} onClose={() => setHist(null)} />
      <MonthlyDialog open={monthly} series={ref.series} today={today} onClose={() => setMonthly(false)} onSaved={() => { setMonthly(false); reload() }} />
    </>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return <Card className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("text-xl font-semibold tabular-nums", tone === "bad" && "text-red-700", tone === "good" && "text-green-700")}>{value}</p>{sub && <p className="text-xs text-muted-foreground">{sub}</p>}</Card>
}
function Breakdown({ title, rows }: { title: string; rows: (string | number)[][] }) {
  return <Card className="p-4"><h2 className="text-sm font-semibold">{title}</h2>{rows.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Sem dados no período.</p> : <ul className="mt-2 space-y-1 text-sm">{rows.map(([k, v]) => <li key={String(k)} className="flex justify-between gap-2"><span className="truncate">{k}</span><span className="tabular-nums">{formatBRL(Number(v) / 100)}</span></li>)}</ul>}</Card>
}

function ReceivableForm({ open, rec, today, onClose, onSaved }: { open: boolean; rec: Rec | null; today: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = React.useState({ client: rec?.client_name ?? "", description: rec?.description ?? "", due: rec?.due_on ?? addDays(today, 7), amount: rec ? centsToInput(rec.amount_cents) : "", notes: rec?.notes ?? "" })
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const cents = toCents(v.amount)
    if (!Number.isFinite(cents) || cents < 0) return toast.error("Valor inválido.")
    setBusy(true)
    const r = rec ? await supabase().rpc("court_receivable_update", { p_id: rec.id, p_description: v.description, p_due: v.due, p_amount_cents: cents, p_notes: v.notes })
      : await supabase().rpc("court_receivable_create", { p_booking: null, p_client: null, p_client_name: v.client, p_description: v.description, p_due: v.due, p_amount_cents: cents, p_method: null, p_notes: v.notes || null })
    setBusy(false)
    if (r.error) return toast.error(r.error.message)
    toast.success("Lançamento salvo."); onSaved()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{rec ? `Editar ${rec.code}` : "Novo lançamento"}</DialogTitle><DialogDescription>{rec ? "O valor não pode ficar abaixo do que já foi pago." : "Para cobrar uma reserva, use a reserva na Agenda ou na lista de Reservas (botão “Gerar cobrança” nos detalhes da reserva)."}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          {!rec && <div className="space-y-1.5"><Label htmlFor="rc">Cliente</Label><Input id="rc" required minLength={2} maxLength={120} value={v.client} onChange={(e) => setV({ ...v, client: e.target.value })} /></div>}
          <div className="space-y-1.5"><Label htmlFor="rd">Descrição</Label><Input id="rd" required minLength={2} maxLength={200} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="rv">Valor (R$)</Label><Input id="rv" required inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="0,00" /></div>
            <div className="space-y-1.5"><Label htmlFor="rw">Vencimento</Label><Input id="rw" type="date" required value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="rn">Observações</Label><Input id="rn" maxLength={500} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Fechar</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Salvar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PayDialog({ rec, today, onClose, onSaved }: { rec: Rec | null; today: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = React.useState({ amount: "", method: "pix", date: today, note: "" })
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (rec) setV({ amount: centsToInput(rec.amount_cents - rec.paid_cents), method: "pix", date: today, note: "" }) }, [rec, today])
  if (!rec) return null
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const cents = toCents(v.amount)
    if (!Number.isFinite(cents) || cents <= 0) return toast.error("Informe um valor maior que zero.")
    setBusy(true)
    const r = await supabase().rpc("court_payment_register", { p_receivable: rec!.id, p_amount_cents: cents, p_method: v.method, p_paid_on: v.date, p_note: v.note || null })
    setBusy(false)
    if (r.error) return toast.error(r.error.message)
    toast.success("Pagamento registrado."); onSaved()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Registrar pagamento · {rec.code}</DialogTitle><DialogDescription>{rec.client_name} · saldo {formatBRL((rec.amount_cents - rec.paid_cents) / 100)}. Pode ser parcial.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="pv">Valor (R$)</Label><Input id="pv" required inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="pd">Data</Label><Input id="pd" type="date" max={today} required value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="pm">Forma de pagamento</Label><NativeSelect id="pm" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{PAY_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="pn">Observação</Label><Input id="pn" maxLength={200} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Fechar</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Confirmar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function HistoryDialog({ rec, onClose }: { rec: Rec | null; onClose: () => void }) {
  const { data, loading } = useLoad<Pay[]>(async () => {
    if (!rec) return []
    const r = await supabase().from("court_payments").select("id, amount_cents, method, paid_on, note, created_at").eq("receivable_id", rec.id).order("created_at")
    if (r.error) throw new Error(r.error.message)
    return r.data as Pay[]
  }, [rec?.id])
  if (!rec) return null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Histórico · {rec.code}</DialogTitle><DialogDescription>{rec.description}</DialogDescription></DialogHeader>
        {rec.cancel_reason && <p className="rounded-lg bg-muted p-2 text-sm">Cancelado: {rec.cancel_reason}</p>}
        {loading ? <Skeleton className="h-20" /> : (data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p> : (
          <ul className="space-y-1 text-sm">{(data ?? []).map((p) => <li key={p.id} className="flex justify-between gap-2 rounded-lg border px-2 py-1.5"><span>{fmtDateBR(p.paid_on)} · {methodLabel(p.method)}{p.note && ` · ${p.note}`}</span><span className="tabular-nums">{formatBRL(p.amount_cents / 100)}</span></li>)}</ul>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MonthlyDialog({ open, series, today, onClose, onSaved }: { open: boolean; series: { id: string; client_name: string }[]; today: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = React.useState({ series: "", month: today.slice(0, 7), due: "" })
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const r = await supabase().rpc("court_receivable_generate_monthly", { p_series: v.series, p_month: v.month + "-01", p_due: v.due || null })
    setBusy(false)
    if (r.error) return toast.error(r.error.message)
    toast.success("Mensalidade gerada."); onSaved()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Gerar mensalidade</DialogTitle><DialogDescription>Soma as reservas ativas da recorrência no mês. Uma cobrança por mês e por recorrência.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="ms">Recorrência</Label><NativeSelect id="ms" required value={v.series} onChange={(e) => setV({ ...v, series: e.target.value })}><option value="">Selecione</option>{series.map((s, i) => <option key={s.id} value={s.id}>{s.client_name} (#{series.length - i})</option>)}</NativeSelect></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="mm">Mês</Label><Input id="mm" type="month" required value={v.month} onChange={(e) => setV({ ...v, month: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="md">Vencimento</Label><Input id="md" type="date" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} /></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Fechar</Button><Button type="submit" disabled={busy || !v.series}>{busy && <Loader2 className="size-4 animate-spin" />} Gerar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
