"use client"

import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { SPORTS, sportLabel, useCourtRoleCtx } from "@/hooks/use-court-role"
import { useLoad } from "@/hooks/use-load"
import { KIND_LABEL } from "@/lib/court-booking"
import { fmtDateBR, fmtRange, localParts } from "@/lib/court-time"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { maskPhone, normalizePhone, waLink } from "@/lib/whatsapp"
import { Loader2, MessageCircle, Plus } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Entry = { id: string; name: string; phone: string | null; email: string | null; sport: string | null; court_id: string | null; weekday: number | null; start_min: number | null; kind: string; notes: string | null; status: string; contact_consent: boolean; created_at: string }
type Match = { waitlist_id: string; court_id: string; court_name: string; starts_at: string; ends_at: string }
type Court = { id: string; name: string }
const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]
const STATUS: Record<string, string> = { aguardando: "Aguardando", avisado: "Avisado", atendido: "Atendido", cancelado: "Cancelado" }
const hhmm = (m: number | null) => (m == null ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`)
const phoneShow = (v: string | null) => (v ? maskPhone(v.replace(/^55/, "")) : "—")
const EMPTY = { name: "", phone: "", email: "", sport: "", court_id: "", weekday: "", time: "", kind: "avulsa", notes: "", contact_consent: false }

async function load(allowed: boolean) {
  if (!allowed) return null
  const sb = supabase()
  const [e, c, v, m] = await Promise.all([sb.from("court_waitlist").select("*").order("created_at", { ascending: false }).limit(2000), sb.from("court_courts").select("id, name").order("name"), sb.from("court_venues").select("timezone, trade_name").maybeSingle(), sb.rpc("court_waitlist_matches", { p_days: 14 })])
  if (e.error) throw new Error(e.error.message)
  return { entries: (e.data ?? []) as Entry[], courts: (c.data ?? []) as Court[], tz: (v.data?.timezone as string | undefined) ?? "America/Sao_Paulo", venue: (v.data?.trade_name as string | undefined) ?? "", matches: (m.data ?? []) as Match[] }
}

export default function EsperaPage() {
  const role = useCourtRoleCtx()!
  const allowed = role !== "financeiro"
  const { data, error, loading, reload } = useLoad(() => load(allowed), [allowed])
  const [f, setF] = React.useState({ status: "aguardando", sport: "", court: "", day: "" })
  const [edit, setEdit] = React.useState<Entry | "novo" | null>(null)
  if (!allowed) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">O perfil Financeiro não acessa a lista de espera.</p>
  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading && !data) return <Skeleton className="h-72" />
  if (!data) return null
  const { entries, courts, tz, venue, matches } = data
  const courtName = new Map(courts.map((c) => [c.id, c.name]))
  const rows = entries.filter((x) => (!f.status || x.status === f.status) && (!f.sport || x.sport === f.sport) && (!f.court || x.court_id === f.court) && (!f.day || String(x.weekday) === f.day))
  const waiting = entries.filter((x) => x.status === "aguardando")
  // Horários mais procurados: dia da semana + horário entre os que aguardam.
  const counts = new Map<string, number>()
  for (const x of waiting) if (x.start_min != null) { const k = `${x.weekday == null ? "Qualquer dia" : DAYS[x.weekday]} · ${hhmm(x.start_min)}`; counts.set(k, (counts.get(k) ?? 0) + 1) }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const byEntry = new Map<string, Match[]>()
  for (const m of matches) byEntry.set(m.waitlist_id, [...(byEntry.get(m.waitlist_id) ?? []), m])

  async function mark(id: string, status: string) { const r = await supabase().rpc("court_waitlist_mark", { p_id: id, p_status: status }); if (r.error) toast.error(r.error.message); else reload() }
  async function remove(x: Entry) { if (!window.confirm(`Excluir a solicitação de ${x.name}?`)) return; const r = await supabase().from("court_waitlist").delete().eq("id", x.id); if (r.error) toast.error(r.error.message); else { toast.success("Solicitação excluída."); reload() } }
  function notify(x: Entry, m: Match) {
    const msg = `Olá, ${x.name.split(" ")[0]}! Surgiu um horário na ${m.court_name} (${venue}): ${fmtDateBR(localParts(tz, m.starts_at).date)}, ${fmtRange(tz, m.starts_at, m.ends_at)}. Quer reservar? Responda esta mensagem.`
    window.open(waLink(x.phone!, msg), "_blank", "noopener"); void mark(x.id, "avisado")
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-xl font-semibold">Lista de espera</h1><p className="text-sm text-muted-foreground">Interessados em horários indisponíveis. A lista <strong>não garante reserva</strong>: ao surgir um horário, a equipe avisa e reserva na Agenda.</p></div>
        <Button onClick={() => setEdit("novo")}><Plus className="size-4" /> Novo interessado</Button>
      </div>
      {top.length > 0 && <Card className="p-4"><h2 className="text-sm font-semibold">Horários mais procurados</h2><ul className="mt-2 flex flex-wrap gap-2 text-sm">{top.map(([k, n]) => <li key={k} className="rounded-full bg-muted px-3 py-1">{k} <strong>· {n}</strong></li>)}</ul></Card>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <NativeSelect aria-label="Situação" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Todas as situações</option>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
        <NativeSelect aria-label="Modalidade" value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })}><option value="">Todas as modalidades</option>{SPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
        <NativeSelect aria-label="Quadra" value={f.court} onChange={(e) => setF({ ...f, court: e.target.value })}><option value="">Todas as quadras</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        <NativeSelect aria-label="Dia da semana" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })}><option value="">Todos os dias</option>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</NativeSelect>
      </div>
      <p className="text-sm text-muted-foreground">{rows.length} solicitação(ões)</p>
      <ul className="space-y-2">
        {rows.map((x) => {
          const ms = x.status === "aguardando" ? (byEntry.get(x.id) ?? []).slice(0, 3) : []
          return (
            <li key={x.id} className="rounded-xl border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{x.name} <span className={cn("ml-1 rounded-full px-2 py-0.5 text-xs font-medium", x.status === "aguardando" ? "bg-amber-100 text-amber-900" : x.status === "atendido" ? "bg-green-100 text-green-900" : "bg-slate-200 text-slate-700")}>{STATUS[x.status]}</span></p>
                  <p className="text-sm text-muted-foreground">{phoneShow(x.phone)}{x.email && ` · ${x.email}`}</p>
                  <p className="text-sm">{x.sport ? sportLabel(x.sport) : "Qualquer modalidade"} · {x.court_id ? courtName.get(x.court_id) ?? "quadra" : "qualquer quadra"} · {x.weekday == null ? "qualquer dia" : DAYS[x.weekday]} {hhmm(x.start_min)} · {KIND_LABEL[x.kind as keyof typeof KIND_LABEL]}</p>
                  <p className="text-xs text-muted-foreground">Cadastro em {fmtDateBR(localParts(tz, x.created_at).date)}{x.notes && ` · ${x.notes}`}{!x.contact_consent && " · sem autorização de contato"}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => setEdit(x)}>Editar</Button>
                  {x.status === "aguardando" && <Button size="sm" variant="outline" onClick={() => mark(x.id, "atendido")}>Atendido</Button>}
                  {x.status === "aguardando" && <Button size="sm" variant="outline" onClick={() => mark(x.id, "cancelado")}>Cancelar</Button>}
                  {x.status !== "aguardando" && <Button size="sm" variant="outline" onClick={() => mark(x.id, "aguardando")}>Reabrir</Button>}
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => remove(x)}>Excluir</Button>
                </div>
              </div>
              {ms.length > 0 && (
                <div className="mt-2 rounded-lg bg-green-50 p-2 text-sm text-green-950">
                  <p className="font-medium">Horários livres que combinam (próximos 14 dias):</p>
                  <ul className="mt-1 space-y-1">
                    {ms.map((m) => (
                      <li key={m.court_id + m.starts_at} className="flex flex-wrap items-center justify-between gap-2">
                        <span>{m.court_name} · {fmtDateBR(localParts(tz, m.starts_at).date)} · {fmtRange(tz, m.starts_at, m.ends_at)}</span>
                        {x.phone && x.contact_consent && <Button size="sm" onClick={() => notify(x, m)}><MessageCircle className="size-4" /> Avisar no WhatsApp</Button>}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs">{x.contact_consent ? "O botão abre o WhatsApp para você enviar; nada é enviado automaticamente." : "Sem autorização de contato: só avise se a pessoa consentir (edite a solicitação)."}</p>
                </div>
              )}
            </li>
          )
        })}
        {rows.length === 0 && <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma solicitação.</li>}
      </ul>
      <EntryForm key={edit === "novo" ? "novo" : edit?.id ?? "x"} open={!!edit} entry={edit === "novo" ? null : edit} courts={courts} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />
    </>
  )
}

function EntryForm({ open, entry, courts, onClose, onSaved }: { open: boolean; entry: Entry | null; courts: Court[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = React.useState(() => entry ? { name: entry.name, phone: entry.phone ? phoneShow(entry.phone) : "", email: entry.email ?? "", sport: entry.sport ?? "", court_id: entry.court_id ?? "", weekday: entry.weekday == null ? "" : String(entry.weekday), time: entry.start_min == null ? "" : hhmm(entry.start_min), kind: entry.kind, notes: entry.notes ?? "", contact_consent: entry.contact_consent } : EMPTY)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof EMPTY>(k: K, x: (typeof EMPTY)[K]) => setV((s) => ({ ...s, [k]: x }))
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const ph = v.phone ? normalizePhone(v.phone) : null
    if (!ph && !v.email) return toast.error("Informe telefone ou e-mail.")
    const [h, m] = v.time ? v.time.split(":").map(Number) : [null, null]
    setBusy(true)
    const row = { name: v.name, phone: ph, email: v.email || null, sport: v.sport || null, court_id: v.court_id || null, weekday: v.weekday === "" ? null : Number(v.weekday), start_min: h == null ? null : h * 60 + (m ?? 0), kind: v.kind, notes: v.notes || null, contact_consent: v.contact_consent }
    const r = entry ? await supabase().from("court_waitlist").update(row).eq("id", entry.id) : await supabase().from("court_waitlist").insert(row)
    setBusy(false)
    if (r.error) return toast.error(r.error.message)
    toast.success("Solicitação salva."); onSaved()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{entry ? "Editar solicitação" : "Novo interessado"}</DialogTitle><DialogDescription>Informe o horário desejado para o sistema apontar quando ele ficar livre.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="wn">Nome</Label><Input id="wn" required minLength={2} maxLength={120} value={v.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="wp">Telefone</Label><Input id="wp" inputMode="tel" value={v.phone} onChange={(e) => set("phone", maskPhone(e.target.value))} /></div>
          <div className="space-y-1.5"><Label htmlFor="we">E-mail</Label><Input id="we" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="ws">Modalidade</Label><NativeSelect id="ws" value={v.sport} onChange={(e) => set("sport", e.target.value)}><option value="">Qualquer</option>{SPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="wc">Quadra desejada</Label><NativeSelect id="wc" value={v.court_id} onChange={(e) => set("court_id", e.target.value)}><option value="">Qualquer</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="wd">Dia da semana</Label><NativeSelect id="wd" value={v.weekday} onChange={(e) => set("weekday", e.target.value)}><option value="">Qualquer</option>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="wt">Horário desejado</Label><Input id="wt" type="time" step={1800} value={v.time} onChange={(e) => set("time", e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="wk">Tipo de reserva</Label><NativeSelect id="wk" value={v.kind} onChange={(e) => set("kind", e.target.value)}><option value="avulsa">Reserva avulsa</option><option value="mensalista">Mensalista</option><option value="mensalista_professor">Mensalista com professor</option></NativeSelect></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="wo">Observações</Label><Input id="wo" maxLength={500} value={v.notes} onChange={(e) => set("notes", e.target.value)} /></div>
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={v.contact_consent} onChange={(e) => set("contact_consent", e.target.checked)} /><span>A pessoa autorizou ser avisada por WhatsApp/e-mail quando surgir um horário. (LGPD)</span></label>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Salvar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
