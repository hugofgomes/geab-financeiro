"use client"

import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SPORTS, sportLabel, type CourtRole } from "@/hooks/use-court-role"
import { BLOCK_REASON, KIND_LABEL, KIND_STYLE, PAY_METHODS, PAY_STATUS_LABEL, STATUS_LABEL, bookingTitle, whatsappLink, type Booking, type Court, type Kind, type Venue } from "@/lib/court-booking"
import { fmtDateLong, fmtMinutes, fmtRange, localParts, todayIn, zonedToUtc } from "@/lib/court-time"
import { formatBRL } from "@/lib/format"
import { supabase } from "@/lib/supabase/client"
import { maskPhone } from "@/lib/whatsapp"
import { History, Loader2, MessageCircle } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

export type Ctx = { venue: Venue; courts: Court[]; role: CourtRole; reload: () => void }
const can = (role: CourtRole) => role === "admin" || role === "gerente" || role === "recepcionista"

function Field({ id, label, children, className }: { id: string; label: string; children: React.ReactNode; className?: string }) {
  return <div className={`space-y-1.5 ${className ?? ""}`}><Label htmlFor={id}>{label}</Label>{children}</div>
}
const inp = "h-11 sm:h-9"
const centsOf = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100)
const brlText = (c: number) => (c / 100).toFixed(2).replace(".", ",")
/** Horários do dia na grade do centro (00:00 até 24:00 no campo "fim"). */
const times = (slot: number, withEnd: boolean) => { const o: number[] = []; for (let m = 0; m <= (withEnd ? 1440 : 1440 - slot); m += slot) o.push(m); return o }
const dbMsg = (m: string) => m.replace(/^.*?(Horário indisponível)/, "$1")

type Initial = { courtId?: string; date?: string; startMin?: number; endMin?: number }

/** Criar reserva (com recorrência opcional) ou editar os dados de uma reserva existente. */
export function BookingFormDialog({ open, onClose, ctx, initial, editing }: { open: boolean; onClose: () => void; ctx: Ctx; initial?: Initial; editing?: Booking | null }) {
  const { venue, courts } = ctx
  const tz = venue.timezone
  const active = courts.filter((c) => c.active)
  const [f, setF] = React.useState({ name: "", phone: "", courtId: "", sport: "", date: "", startMin: 1200, endMin: 1260, kind: "avulsa" as Exclude<Kind, "bloqueio">, price: "", method: "", payStatus: "em_aberto", status: "confirmada", notes: "" })
  const [touched, setTouched] = React.useState(false)
  const [repeat, setRepeat] = React.useState(false)
  const [rep, setRep] = React.useState({ freq: "semanal", mode: "count", count: "8", until: "" })
  const [scope, setScope] = React.useState<"one" | "future">("one")
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<{ created: number; conflicts: { date: string; reason: string }[] } | null>(null)

  React.useEffect(() => {
    if (!open) return
    setResult(null); setRepeat(false); setScope("one"); setRep({ freq: "semanal", mode: "count", count: "8", until: "" })
    if (editing) {
      const s = localParts(tz, editing.starts_at), e = localParts(tz, editing.ends_at)
      setF({ name: editing.client_name ?? "", phone: editing.client_phone ? maskPhone(editing.client_phone.replace(/^55/, "")) : "", courtId: editing.court_id, sport: editing.sport ?? "", date: s.date, startMin: s.minutes, endMin: e.date !== s.date ? 1440 : e.minutes, kind: editing.kind === "bloqueio" ? "avulsa" : editing.kind, price: brlText(editing.price_cents), method: editing.payment_method ?? "", payStatus: editing.payment_status, status: editing.status, notes: editing.notes ?? "" })
      setTouched(true)
    } else {
      const court = active.find((c) => c.id === initial?.courtId) ?? active[0]
      const start = initial?.startMin ?? 1200
      setF({ name: "", phone: "", courtId: court?.id ?? "", sport: court?.sport ?? "", date: initial?.date ?? todayIn(tz), startMin: start, endMin: initial?.endMin ?? Math.min(1440, start + Math.max(venue.min_duration_minutes, venue.slot_minutes)), kind: "avulsa", price: "", method: "", payStatus: "em_aberto", status: "confirmada", notes: "" })
      setTouched(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id])

  // Prévia do valor (regras de preço do centro), enquanto o valor não for digitado à mão.
  React.useEffect(() => {
    if (!open || editing || touched || !f.courtId || f.endMin <= f.startMin || !f.date) return
    let alive = true
    const t = setTimeout(() => {
      supabase().rpc("court_price_preview", { p_court: f.courtId, p_kind: f.kind, p_start: zonedToUtc(tz, f.date, f.startMin).toISOString(), p_end: zonedToUtc(tz, f.date, f.endMin).toISOString() })
        .then((r) => { if (alive && typeof r.data === "number") setF((x) => ({ ...x, price: brlText(r.data as number) })) })
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [open, editing, touched, f.courtId, f.kind, f.date, f.startMin, f.endMin, tz])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const sb = supabase()
    const cents = f.price.trim() ? centsOf(f.price) : null
    if (cents != null && (!Number.isFinite(cents) || cents < 0)) return toast.error("Valor inválido.")
    setBusy(true)
    try {
      if (editing) {
        const patch: Record<string, unknown> = { client_name: f.name, client_phone: f.phone.trim() || null, sport: f.sport || null, price_cents: cents ?? 0, payment_method: f.method || null, payment_status: f.payStatus, notes: f.notes || null, kind: f.kind }
        const r = await sb.rpc("court_booking_update", { p_id: editing.id, p_patch: patch, p_scope: scope })
        if (r.error) throw new Error(r.error.message)
        toast.success(scope === "future" ? "Reservas atualizadas." : "Reserva atualizada."); ctx.reload(); onClose(); return
      }
      if (repeat) {
        const r = await sb.rpc("court_series_create", { p_court: f.courtId, p_kind: f.kind, p_client_name: f.name, p_client_phone: f.phone.trim() || null, p_sport: f.sport || null, p_first_date: f.date, p_start_min: f.startMin, p_duration_min: f.endMin - f.startMin, p_frequency: rep.freq, p_until: rep.mode === "until" ? rep.until || null : null, p_count: rep.mode === "count" ? Number(rep.count) : null, p_price_cents: touched ? cents : null, p_payment_method: f.method || null, p_status: f.status })
        if (r.error) throw new Error(r.error.message)
        const d = r.data as { created: number; conflicts: { date: string; reason: string }[] }
        ctx.reload()
        if (d.conflicts.length) { setResult(d); return }
        toast.success(`${d.created} reservas criadas.`); onClose(); return
      }
      const r = await sb.rpc("court_booking_create", { p_court: f.courtId, p_kind: f.kind, p_client_name: f.name, p_client_phone: f.phone.trim() || null, p_sport: f.sport || null, p_start: zonedToUtc(tz, f.date, f.startMin).toISOString(), p_end: zonedToUtc(tz, f.date, f.endMin).toISOString(), p_price_cents: touched ? cents : null, p_payment_method: f.method || null, p_payment_status: f.payStatus, p_status: f.status, p_notes: f.notes || null })
      if (r.error) throw new Error(r.error.message)
      toast.success("Reserva criada."); ctx.reload(); onClose()
    } catch (err) { toast.error(dbMsg(err instanceof Error ? err.message : "Não foi possível salvar.")) }
    setBusy(false)
  }

  const slot = venue.slot_minutes
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? `Editar reserva ${editing.code}` : "Nova reserva"}</DialogTitle><DialogDescription>{editing ? "Para mudar quadra ou horário, use Remarcar." : "O horário só é aceito se estiver livre e dentro do funcionamento da quadra."}</DialogDescription></DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            <p className="font-medium text-green-800">{result.created} reserva(s) criada(s).</p>
            <p className="font-medium text-amber-800">{result.conflicts.length} data(s) não puderam ser reservadas:</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg bg-amber-50 p-3">{result.conflicts.map((c) => <li key={c.date}>{c.date.split("-").reverse().join("/")}: {c.reason}</li>)}</ul>
            <DialogFooter><Button onClick={onClose}>Entendi</Button></DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <Field id="b-n" label="Cliente / responsável" className="sm:col-span-2"><Input id="b-n" required minLength={2} maxLength={120} className={inp} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field id="b-p" label="Telefone / WhatsApp"><Input id="b-p" type="tel" inputMode="tel" className={inp} value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} /></Field>
            <Field id="b-k" label="Tipo de reserva"><NativeSelect id="b-k" className={`${inp} w-full`} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}>
              <option value="avulsa">Reserva avulsa</option><option value="mensalista">Mensalista</option><option value="mensalista_professor">Mensalista com professor</option></NativeSelect></Field>
            {!editing && <>
              <Field id="b-c" label="Quadra"><NativeSelect id="b-c" className={`${inp} w-full`} value={f.courtId} onChange={(e) => setF({ ...f, courtId: e.target.value, sport: active.find((c) => c.id === e.target.value)?.sport ?? f.sport })}>{active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
              <Field id="b-d" label="Data"><Input id="b-d" type="date" required className={inp} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
              <Field id="b-i" label="Início"><NativeSelect id="b-i" className={`${inp} w-full`} value={f.startMin} onChange={(e) => { const s = Number(e.target.value); setF({ ...f, startMin: s, endMin: Math.max(f.endMin, s + slot) }) }}>{times(slot, false).map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}</NativeSelect></Field>
              <Field id="b-f" label="Fim"><NativeSelect id="b-f" className={`${inp} w-full`} value={f.endMin} onChange={(e) => setF({ ...f, endMin: Number(e.target.value) })}>{times(slot, true).filter((m) => m > f.startMin).map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}</NativeSelect></Field>
            </>}
            <Field id="b-s" label="Modalidade"><NativeSelect id="b-s" className={`${inp} w-full`} value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })}><option value="">Da quadra</option>{SPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
            <Field id="b-v" label="Valor (R$)"><Input id="b-v" inputMode="decimal" className={inp} value={f.price} onChange={(e) => { setTouched(true); setF({ ...f, price: e.target.value }) }} /></Field>
            <Field id="b-m" label="Forma de pagamento"><NativeSelect id="b-m" className={`${inp} w-full`} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">—</option>{PAY_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
            <Field id="b-ps" label="Situação financeira"><NativeSelect id="b-ps" className={`${inp} w-full`} value={f.payStatus} onChange={(e) => setF({ ...f, payStatus: e.target.value })}>{Object.entries(PAY_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
            {!editing && <Field id="b-st" label="Situação da reserva"><NativeSelect id="b-st" className={`${inp} w-full`} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="confirmada">Confirmada</option><option value="pendente">Pendente de confirmação</option></NativeSelect></Field>}
            <Field id="b-o" label="Observações" className="sm:col-span-2"><textarea id="b-o" rows={2} maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="w-full rounded-lg border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm" /></Field>

            {editing?.series_id && (
              <fieldset className="space-y-1 sm:col-span-2"><legend className="text-sm font-medium">Esta reserva faz parte de uma recorrência</legend>
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" className="size-5" checked={scope === "one"} onChange={() => setScope("one")} /> Alterar somente esta ocorrência</label>
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" className="size-5" checked={scope === "future"} onChange={() => setScope("future")} /> Alterar esta e as próximas</label></fieldset>
            )}
            {!editing && (
              <div className="space-y-2 rounded-xl border p-3 sm:col-span-2">
                <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-5" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Repetir esta reserva (recorrência)</label>
                {repeat && <div className="grid gap-3 sm:grid-cols-3">
                  <Field id="r-f" label="Frequência"><NativeSelect id="r-f" className={`${inp} w-full`} value={rep.freq} onChange={(e) => setRep({ ...rep, freq: e.target.value })}><option value="semanal">Toda semana</option><option value="quinzenal">A cada 15 dias</option><option value="mensal">Todo mês (mesmo dia)</option></NativeSelect></Field>
                  <Field id="r-m" label="Termina"><NativeSelect id="r-m" className={`${inp} w-full`} value={rep.mode} onChange={(e) => setRep({ ...rep, mode: e.target.value })}><option value="count">Após quantidade</option><option value="until">Em uma data</option></NativeSelect></Field>
                  {rep.mode === "count" ? <Field id="r-c" label="Ocorrências (até 104)"><Input id="r-c" inputMode="numeric" className={inp} value={rep.count} onChange={(e) => setRep({ ...rep, count: e.target.value })} /></Field>
                    : <Field id="r-u" label="Até"><Input id="r-u" type="date" className={inp} value={rep.until} onChange={(e) => setRep({ ...rep, until: e.target.value })} /></Field>}
                  <p className="text-xs text-muted-foreground sm:col-span-3">Cada ocorrência vira uma reserva própria, com presença, cancelamento e pagamento individuais. Datas em conflito são listadas ao final.</p>
                </div>}
              </div>
            )}
            <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy || !f.courtId}>{busy && <Loader2 className="animate-spin" />} {editing ? "Salvar alterações" : repeat ? "Criar reservas" : "Criar reserva"}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Bloqueio de horário (manutenção, torneio, outros) em uma ou mais quadras. */
export function BlockDialog({ open, onClose, ctx, initial }: { open: boolean; onClose: () => void; ctx: Ctx; initial?: Initial }) {
  const { venue, courts } = ctx
  const tz = venue.timezone
  const [sel, setSel] = React.useState<string[]>([])
  const [f, setF] = React.useState({ reason: "manutencao", date: "", startMin: 480, endMin: 1380, notes: "" })
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (!open) return
    setSel(initial?.courtId ? [initial.courtId] : [])
    setF({ reason: "manutencao", date: initial?.date ?? todayIn(tz), startMin: initial?.startMin ?? 480, endMin: initial?.endMin ?? 1380, notes: "" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const r = await supabase().rpc("court_block_create", { p_courts: sel, p_reason: f.reason, p_start: zonedToUtc(tz, f.date, f.startMin).toISOString(), p_end: zonedToUtc(tz, f.date, f.endMin).toISOString(), p_notes: f.notes || null })
    setBusy(false)
    if (r.error) return toast.error(r.error.message)
    toast.success("Horário bloqueado."); ctx.reload(); onClose()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>Bloquear horário</DialogTitle><DialogDescription>O bloqueio impede novas reservas no período. Se já houver reserva, cancele ou remarque antes.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <fieldset><legend className="mb-1 text-sm font-medium">Quadras</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2">{courts.map((c) => <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={sel.includes(c.id)} onChange={() => setSel((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))} /> {c.name}</label>)}</div>
            <button type="button" className="min-h-9 text-xs text-primary underline" onClick={() => setSel(sel.length === courts.length ? [] : courts.map((c) => c.id))}>{sel.length === courts.length ? "Desmarcar todas" : "Marcar todas"}</button></fieldset>
          <Field id="k-r" label="Motivo"><NativeSelect id="k-r" className={`${inp} w-full`} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{Object.entries(BLOCK_REASON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
          <Field id="k-d" label="Data"><Input id="k-d" type="date" required className={inp} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="k-i" label="Início"><NativeSelect id="k-i" className={`${inp} w-full`} value={f.startMin} onChange={(e) => setF({ ...f, startMin: Number(e.target.value), endMin: Math.max(f.endMin, Number(e.target.value) + venue.slot_minutes) })}>{times(venue.slot_minutes, false).map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}</NativeSelect></Field>
            <Field id="k-f" label="Fim"><NativeSelect id="k-f" className={`${inp} w-full`} value={f.endMin} onChange={(e) => setF({ ...f, endMin: Number(e.target.value) })}>{times(venue.slot_minutes, true).filter((m) => m > f.startMin).map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}</NativeSelect></Field>
          </div>
          <Field id="k-o" label="Observações"><Input id="k-o" maxLength={500} className={inp} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy || sel.length === 0}>{busy && <Loader2 className="animate-spin" />} Bloquear</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type Mode = "detail" | "reschedule" | "cancel" | "history"
const FIELD_LABEL: Record<string, string> = { status: "Situação", starts_at: "Início", ends_at: "Fim", court_id: "Quadra", price_cents: "Valor", payment_status: "Pagamento", payment_method: "Forma de pagamento", client_name: "Cliente", client_phone: "Telefone", notes: "Observações", kind: "Tipo", sport: "Modalidade" }

/** Detalhes de uma reserva ou bloqueio: confirmar, concluir, editar, remarcar, cancelar, histórico e WhatsApp. */
export function DetailDialog({ booking, onClose, ctx, onEdit }: { booking: Booking | null; onClose: () => void; ctx: Ctx; onEdit: (b: Booking) => void }) {
  const { venue, courts, role } = ctx
  const tz = venue.timezone
  const [mode, setMode] = React.useState<Mode>("detail")
  const [busy, setBusy] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const [scope, setScope] = React.useState<"one" | "future">("one")
  const [rs, setRs] = React.useState({ courtId: "", date: "", startMin: 0, endMin: 0 })
  const [hist, setHist] = React.useState<{ at: string; action: string; by_name: string; detail: Record<string, unknown> }[] | null>(null)
  const b = booking
  React.useEffect(() => {
    if (!b) return
    setMode("detail"); setReason(""); setScope("one"); setHist(null)
    const s = localParts(tz, b.starts_at), e = localParts(tz, b.ends_at)
    setRs({ courtId: b.court_id, date: s.date, startMin: s.minutes, endMin: e.date !== s.date ? 1440 : e.minutes })
  }, [b, tz])
  if (!b) return null
  const court = courts.find((c) => c.id === b.court_id)
  const isBlock = b.kind === "bloqueio"
  async function charge() {
    setBusy(true)
    const r = await supabase().rpc("court_receivable_create", { p_booking: b!.id, p_client: null, p_client_name: null, p_description: null, p_due: localParts(tz, b!.starts_at).date, p_amount_cents: null, p_method: null, p_notes: null })
    setBusy(false)
    if (r.error) toast.error(r.error.message); else toast.success("Cobrança gerada em Financeiro.")
  }
  const editable = (isBlock ? role === "admin" || role === "gerente" : can(role)) && (b.status === "pendente" || b.status === "confirmada" || (!isBlock && (b.status === "concluida" || b.status === "nao_compareceu")))
  const live = b.status === "pendente" || b.status === "confirmada"
  const started = new Date(b.starts_at) <= new Date()

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string, close = true) {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (r.error) return toast.error(dbMsg(r.error.message))
    toast.success(ok); ctx.reload(); if (close) onClose()
  }
  const setStatus = (status: string, msg: string) => run(() => supabase().rpc("court_booking_update", { p_id: b.id, p_patch: { status } }), msg)
  async function openHistory() {
    setMode("history")
    const r = await supabase().rpc("court_booking_history", { p_id: b!.id })
    setHist(r.error ? [] : (r.data as typeof hist))
  }
  const changes = (i: number) => {
    const row = hist![i], prev = hist![i - 1]
    if (row.action === "INSERT") return "Reserva criada"
    if (!prev) return "Alterada"
    const out: string[] = []
    for (const k of Object.keys(FIELD_LABEL)) if (JSON.stringify(row.detail[k]) !== JSON.stringify(prev.detail[k])) out.push(`${FIELD_LABEL[k]}: ${k === "status" ? STATUS_LABEL[row.detail[k] as keyof typeof STATUS_LABEL] ?? String(row.detail[k]) : k === "price_cents" ? formatBRL(Number(row.detail[k]) / 100) : k.endsWith("_at") ? fmtRange(tz, String(row.detail.starts_at), String(row.detail.ends_at)) + " em " + localParts(tz, String(row.detail.starts_at)).date.split("-").reverse().join("/") : String(row.detail[k] ?? "—")}`)
    return out.length ? out.join(" · ") : "Atualização interna"
  }
  const slot = venue.slot_minutes

  return (
    <Dialog open={!!b} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2"><span className={`inline-block size-3 rounded-full ${KIND_STYLE[b.kind].dot}`} aria-hidden />{bookingTitle(b)}</DialogTitle>
          <DialogDescription>{b.code} · {KIND_LABEL[b.kind]}{b.series_id ? ` · ocorrência ${b.occurrence_no}` : ""}</DialogDescription>
        </DialogHeader>

        {mode === "detail" && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
              <div><dt className="text-xs text-muted-foreground">Quadra</dt><dd className="font-medium">{court?.name ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Situação</dt><dd className="font-medium">{STATUS_LABEL[b.status]}{b.late_cancel ? " (cancelamento tardio)" : ""}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-muted-foreground">Quando</dt><dd className="font-medium">{fmtDateLong(localParts(tz, b.starts_at).date)}, {fmtRange(tz, b.starts_at, b.ends_at)}</dd></div>
              {!isBlock && <>
                <div><dt className="text-xs text-muted-foreground">Valor</dt><dd className="font-medium">{formatBRL(b.price_cents / 100)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Pagamento</dt><dd className="font-medium">{PAY_STATUS_LABEL[b.payment_status]}{b.payment_method ? ` · ${PAY_METHODS.find(([k]) => k === b.payment_method)?.[1]}` : ""}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Telefone</dt><dd className="font-medium">{b.client_phone ? maskPhone(b.client_phone.replace(/^55/, "")) : "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Modalidade</dt><dd className="font-medium">{b.sport ? sportLabel(b.sport) : "—"}</dd></div>
              </>}
              {b.notes && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Observações</dt><dd>{b.notes}</dd></div>}
              {b.status === "cancelada" && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Cancelamento</dt><dd>{b.cancel_reason ?? "Sem motivo informado"}</dd></div>}
            </dl>
            <div className="flex flex-wrap gap-2">
              {!isBlock && b.client_phone && <a href={whatsappLink(b, court?.name ?? "quadra", tz, venue.trade_name)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-secondary sm:min-h-9"><MessageCircle className="size-4" /> WhatsApp</a>}
              <Button variant="outline" className="h-11 sm:h-9" onClick={openHistory}><History /> Histórico</Button>
              {!isBlock && b.status !== "cancelada" && (role === "admin" || role === "gerente" || role === "financeiro") && <Button variant="outline" className="h-11 sm:h-9" disabled={busy} onClick={charge}>Gerar cobrança</Button>}
            </div>
            {editable && (
              <div className="grid grid-cols-2 gap-2">
                {!isBlock && b.status === "pendente" && can(role) && <Button className="h-11 sm:h-9" disabled={busy} onClick={() => setStatus("confirmada", "Reserva confirmada.")}>Confirmar</Button>}
                {!isBlock && b.status === "confirmada" && started && can(role) && <Button className="h-11 sm:h-9" disabled={busy} onClick={() => setStatus("concluida", "Reserva concluída.")}>Concluir</Button>}
                {!isBlock && b.status === "confirmada" && started && can(role) && <Button variant="outline" className="h-11 sm:h-9" disabled={busy} onClick={() => setStatus("nao_compareceu", "Marcada como não compareceu.")}>Não compareceu</Button>}
                {live && <Button variant="outline" className="h-11 sm:h-9" onClick={() => onEdit(b)}>Editar</Button>}
                {live && !isBlock && <Button variant="outline" className="h-11 sm:h-9" onClick={() => setMode("reschedule")}>Remarcar</Button>}
                {live && <Button variant="destructive" className="h-11 sm:h-9" onClick={() => setMode("cancel")}>{isBlock ? "Remover bloqueio" : "Cancelar reserva"}</Button>}
              </div>
            )}
          </div>
        )}

        {mode === "reschedule" && (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => supabase().rpc("court_booking_reschedule", { p_id: b.id, p_court: rs.courtId, p_start: zonedToUtc(tz, rs.date, rs.startMin).toISOString(), p_end: zonedToUtc(tz, rs.date, rs.endMin).toISOString() }), "Reserva remarcada.") }}>
            <Field id="m-c" label="Quadra"><NativeSelect id="m-c" className={`${inp} w-full`} value={rs.courtId} onChange={(e) => setRs({ ...rs, courtId: e.target.value })}>{courts.filter((c) => c.active || c.id === b.court_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
            <Field id="m-d" label="Nova data"><Input id="m-d" type="date" required className={inp} value={rs.date} onChange={(e) => setRs({ ...rs, date: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="m-i" label="Início"><NativeSelect id="m-i" className={`${inp} w-full`} value={rs.startMin} onChange={(e) => setRs({ ...rs, startMin: Number(e.target.value), endMin: Math.max(rs.endMin, Number(e.target.value) + slot) })}>{times(slot, false).map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}</NativeSelect></Field>
              <Field id="m-f" label="Fim"><NativeSelect id="m-f" className={`${inp} w-full`} value={rs.endMin} onChange={(e) => setRs({ ...rs, endMin: Number(e.target.value) })}>{times(slot, true).filter((m) => m > rs.startMin).map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}</NativeSelect></Field>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setMode("detail")}>Voltar</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Remarcar</Button></DialogFooter>
          </form>
        )}

        {mode === "cancel" && (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => supabase().rpc("court_booking_cancel", { p_id: b.id, p_reason: reason, p_scope: scope }), isBlock ? "Bloqueio removido." : "Reserva cancelada.") }}>
            <p className="text-sm">{isBlock ? "Remover este bloqueio libera o horário na agenda." : "A reserva fica no histórico e o horário volta a ficar livre."}{!isBlock && new Date(b.starts_at) > new Date() && venue.cancel_free_hours > 0 && new Date(b.starts_at).getTime() - Date.now() < venue.cancel_free_hours * 3600000 ? ` Atenção: faltam menos de ${venue.cancel_free_hours}h para o horário (cancelamento tardio${venue.cancel_fee_pct ? `, taxa de ${venue.cancel_fee_pct}%` : ""}).` : ""}</p>
            <Field id="x-r" label="Motivo (opcional)"><Input id="x-r" maxLength={200} className={inp} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            {b.series_id && <fieldset className="space-y-1"><legend className="text-sm font-medium">Recorrência</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" className="size-5" checked={scope === "one"} onChange={() => setScope("one")} /> Somente esta ocorrência</label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" className="size-5" checked={scope === "future"} onChange={() => setScope("future")} /> Esta e as próximas</label></fieldset>}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setMode("detail")}>Voltar</Button><Button type="submit" variant="destructive" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Confirmar cancelamento</Button></DialogFooter>
          </form>
        )}

        {mode === "history" && (
          <div className="space-y-3">
            {hist === null ? <Loader2 className="mx-auto animate-spin text-muted-foreground" /> : hist.length === 0 ? <p className="text-sm text-muted-foreground">Sem registros.</p> : (
              <ul className="divide-y text-sm">{hist.map((h, i) => <li key={i} className="py-2"><div className="font-medium">{changes(i)}</div><div className="text-xs text-muted-foreground">{new Date(h.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: tz })} · {h.by_name}</div></li>)}</ul>
            )}
            <DialogFooter><Button variant="outline" onClick={() => setMode("detail")}>Voltar</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

