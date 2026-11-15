"use client"

import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCourtRoleCtx } from "@/hooks/use-court-role"
import { useLoad } from "@/hooks/use-load"
import { KIND_LABEL, type Court, type Hours, type Venue } from "@/lib/court-booking"
import { WEEKDAYS, WEEKDAYS_SHORT, fmtMinutes } from "@/lib/court-time"
import { formatBRL } from "@/lib/format"
import { supabase } from "@/lib/supabase/client"
import { Loader2, Plus, Trash2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Rule = { id: string; court_id: string | null; name: string; weekdays: number[]; from_min: number; to_min: number; kind: string | null; price_cents: number; priority: number; active: boolean }
type VenueRules = Pick<Venue, "id" | "slot_minutes" | "min_duration_minutes" | "min_notice_minutes" | "max_advance_days" | "cancel_free_hours" | "cancel_fee_pct" | "timezone">

async function load() {
  const sb = supabase()
  const [v, c, h, r] = await Promise.all([
    sb.from("court_venues").select("id, slot_minutes, min_duration_minutes, min_notice_minutes, max_advance_days, cancel_free_hours, cancel_fee_pct, timezone").maybeSingle(),
    sb.from("court_courts").select("id, name, sport, active, price_cents").order("sort_order").order("name"),
    sb.from("court_hours").select("id, court_id, weekday, opens_min, closes_min, active").order("opens_min"),
    sb.from("court_price_rules").select("*").order("priority", { ascending: false }).order("name"),
  ])
  for (const x of [v, c, h, r]) if (x.error) throw new Error(x.error.message)
  return { venue: v.data as VenueRules | null, courts: c.data as Court[], hours: h.data as Hours[], rules: r.data as Rule[] }
}
const opts = (step: number, max: number, min = 0) => { const o: number[] = []; for (let m = min; m <= max; m += step) o.push(m); return o }
const inp = "h-11 sm:h-9"
const centsOf = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100)

export default function ConfiguracoesPage() {
  const role = useCourtRoleCtx()
  const { data, error, loading, reload } = useLoad(load, [])
  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading && !data) return <Skeleton className="h-72" />
  if (!data) return null
  if (!data.venue) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Cadastre primeiro o centro esportivo (menu Centro Esportivo).</p>
  const canEdit = role === "admin"
  return (
    <>
      <div><h1 className="text-2xl font-bold tracking-tight">Configurações</h1><p className="text-sm text-muted-foreground">Funcionamento, preços e regras da agenda.{!canEdit && " Somente o administrador altera estas configurações."}</p></div>
      <Tabs defaultValue="funcionamento">
        <TabsList className="h-12 w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="funcionamento" className="h-10 shrink-0 px-4">Funcionamento</TabsTrigger>
          <TabsTrigger value="precos" className="h-10 shrink-0 px-4">Preços</TabsTrigger>
          <TabsTrigger value="regras" className="h-10 shrink-0 px-4">Regras</TabsTrigger>
        </TabsList>
        <TabsContent value="funcionamento"><HoursTab courts={data.courts} hours={data.hours} canEdit={canEdit} reload={reload} /></TabsContent>
        <TabsContent value="precos"><PricesTab courts={data.courts} rules={data.rules} canEdit={canEdit} reload={reload} /></TabsContent>
        <TabsContent value="regras"><RulesTab venue={data.venue} canEdit={canEdit} reload={reload} /></TabsContent>
      </Tabs>
    </>
  )
}

function HoursTab({ courts, hours, canEdit, reload }: { courts: Court[]; hours: Hours[]; canEdit: boolean; reload: () => void }) {
  const [scope, setScope] = React.useState("")            // "" = padrão do centro
  const [busy, setBusy] = React.useState(false)
  const own = scope ? hours.filter((h) => h.court_id === scope) : []
  const usesOwn = !scope || own.length > 0
  const rows = scope ? own : hours.filter((h) => h.court_id === null)
  const sb = supabase()
  async function op(fn: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) {
    setBusy(true); const r = await fn(); setBusy(false)
    if (r.error) return toast.error(r.error.message)
    if (ok) toast.success(ok); reload()
  }
  const add = (day: number) => {
    const last = rows.filter((h) => h.weekday === day).sort((a, b) => b.closes_min - a.closes_min)[0]
    const opens = last ? Math.min(last.closes_min + 60, 1380) : 480, closes = Math.min(opens + 480, 1440)
    return op(() => sb.from("court_hours").insert({ court_id: scope || null, weekday: day, opens_min: opens, closes_min: closes }))
  }
  const copyDay = async (day: number) => {
    const src = rows.filter((h) => h.weekday === day)
    if (!src.length) return toast.error("Este dia não tem horários para copiar.")
    setBusy(true)
    let q = sb.from("court_hours").delete().neq("weekday", day)
    q = scope ? q.eq("court_id", scope) : q.is("court_id", null)
    const d = await q
    if (d.error) { setBusy(false); return toast.error(d.error.message) }
    const ins = await sb.from("court_hours").insert(Array.from({ length: 7 }, (_, w) => w).filter((w) => w !== day).flatMap((w) => src.map((s) => ({ court_id: scope || null, weekday: w, opens_min: s.opens_min, closes_min: s.closes_min }))))
    setBusy(false)
    if (ins.error) return toast.error(ins.error.message)
    toast.success("Horário copiado para todos os dias."); reload()
  }
  const customize = () => op(() => sb.from("court_hours").insert(hours.filter((h) => h.court_id === null).map((h) => ({ court_id: scope, weekday: h.weekday, opens_min: h.opens_min, closes_min: h.closes_min }))).then((r) => (hours.some((h) => h.court_id === null) ? r : { error: { message: "Cadastre antes o horário padrão do centro." } })))
  const useDefault = () => op(() => sb.from("court_hours").delete().eq("court_id", scope), "Esta quadra voltou a usar o horário padrão.")
  return (
    <Card><CardContent className="space-y-4 pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="h-s">Horários de</Label>
          <NativeSelect id="h-s" className={`${inp} w-full`} value={scope} onChange={(e) => setScope(e.target.value)}><option value="">Padrão do centro (todas as quadras)</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></div>
        {scope && canEdit && <div className="flex items-end">{own.length ? <Button variant="outline" className="h-11 w-full sm:h-9 sm:w-auto" disabled={busy} onClick={useDefault}>Usar o horário padrão do centro</Button> : <Button variant="outline" className="h-11 w-full sm:h-9 sm:w-auto" disabled={busy} onClick={customize}>Definir horários próprios para esta quadra</Button>}</div>}
      </div>
      {scope && !own.length && <p className="rounded-lg bg-secondary p-3 text-sm">Esta quadra usa o horário padrão do centro.</p>}
      {usesOwn && (
        <ul className="divide-y">
          {WEEKDAYS.map((name, day) => {
            const list = rows.filter((h) => h.weekday === day).sort((a, b) => a.opens_min - b.opens_min)
            return (
              <li key={day} className="grid gap-2 py-3 sm:grid-cols-[8rem_1fr]">
                <div className="flex items-center justify-between sm:block"><span className="font-medium">{name}</span>{!list.length && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">Fechado</span>}</div>
                <div className="space-y-2">
                  {list.map((h) => (
                    <div key={h.id} className="flex flex-wrap items-center gap-2">
                      <NativeSelect aria-label={`Abre ${name}`} disabled={!canEdit || busy} className="h-11 w-24 sm:h-9" value={h.opens_min} onChange={(e) => op(() => sb.from("court_hours").update({ opens_min: Number(e.target.value) }).eq("id", h.id))}>{opts(30, 1410).map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}</NativeSelect>
                      <span className="text-sm text-muted-foreground">até</span>
                      <NativeSelect aria-label={`Fecha ${name}`} disabled={!canEdit || busy} className="h-11 w-24 sm:h-9" value={h.closes_min} onChange={(e) => op(() => sb.from("court_hours").update({ closes_min: Number(e.target.value) }).eq("id", h.id))}>{opts(30, 1440, 30).map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}</NativeSelect>
                      {canEdit && <Button variant="ghost" size="icon" className="size-11 sm:size-9" aria-label="Remover horário" disabled={busy} onClick={() => op(() => sb.from("court_hours").delete().eq("id", h.id))}><Trash2 className="size-4" /></Button>}
                    </div>
                  ))}
                  {canEdit && <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" className="h-10 sm:h-8" disabled={busy} onClick={() => add(day)}><Plus /> Adicionar horário</Button>{list.length > 0 && <Button variant="ghost" size="sm" className="h-10 sm:h-8" disabled={busy} onClick={() => copyDay(day)}>Copiar para todos os dias</Button>}</div>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Vários horários no mesmo dia criam intervalos indisponíveis entre eles (ex.: 08:00–12:00 e 14:00–23:00). Dias sem horário ficam fechados.</p>
    </CardContent></Card>
  )
}

const emptyRule = { id: "", name: "", court: "", days: [] as number[], from: 1080, to: 1380, kind: "", price: "", priority: "0", active: true }

function PricesTab({ courts, rules, canEdit, reload }: { courts: Court[]; rules: Rule[]; canEdit: boolean; reload: () => void }) {
  const [edit, setEdit] = React.useState<typeof emptyRule | null>(null)
  const [busy, setBusy] = React.useState(false)
  const open = (r?: Rule) => setEdit(r ? { id: r.id, name: r.name, court: r.court_id ?? "", days: r.weekdays, from: r.from_min, to: r.to_min, kind: r.kind ?? "", price: (r.price_cents / 100).toFixed(2).replace(".", ","), priority: String(r.priority), active: r.active } : { ...emptyRule })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!edit) return
    const cents = centsOf(edit.price)
    if (!Number.isFinite(cents) || cents < 0) return toast.error("Valor inválido.")
    if (!edit.days.length) return toast.error("Escolha ao menos um dia da semana.")
    const payload = { name: edit.name.trim(), court_id: edit.court || null, weekdays: edit.days, from_min: edit.from, to_min: edit.to, kind: edit.kind || null, price_cents: cents, priority: Number(edit.priority) || 0, active: edit.active }
    setBusy(true)
    const sb = supabase()
    const r = edit.id ? await sb.from("court_price_rules").update(payload).eq("id", edit.id) : await sb.from("court_price_rules").insert(payload)
    setBusy(false)
    if (r.error) return toast.error(r.error.message)
    toast.success("Regra salva."); setEdit(null); reload()
  }
  async function remove(r: Rule) {
    if (!window.confirm(`Excluir a regra “${r.name}”?`)) return
    const x = await supabase().from("court_price_rules").delete().eq("id", r.id)
    if (x.error) return toast.error(x.error.message)
    toast.success("Regra excluída."); reload()
  }
  const dayText = (d: number[]) => [...d].sort().map((x) => WEEKDAYS_SHORT[x]).join(", ")
  return (
    <Card><CardContent className="space-y-3 pt-4">
      <p className="text-sm text-muted-foreground">O valor base por hora de cada quadra é definido em Centro Esportivo. As regras abaixo sobrepõem esse valor por dia da semana, faixa de horário e tipo de reserva (mensalista, fim de semana etc.). Vale a regra mais específica: da quadra, do tipo e, por fim, a de maior prioridade. Preços são sempre <b>por hora</b>.</p>
      {canEdit && <Button className="h-11 w-full sm:h-9 sm:w-auto" onClick={() => open()}><Plus /> Nova regra de preço</Button>}
      {rules.length === 0 && <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Nenhuma regra: todas as reservas usam o valor base da quadra.</p>}
      <ul className="divide-y">
        {rules.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div className="min-w-0"><div className="font-medium">{r.name} {!r.active && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-normal">inativa</span>}</div>
              <div className="text-xs text-muted-foreground">{r.court_id ? courts.find((c) => c.id === r.court_id)?.name : "Todas as quadras"} · {dayText(r.weekdays)} · {fmtMinutes(r.from_min)}–{fmtMinutes(r.to_min)} · {r.kind ? KIND_LABEL[r.kind as keyof typeof KIND_LABEL] : "qualquer tipo"}</div></div>
            <div className="flex items-center gap-2"><span className="font-semibold tabular-nums">{formatBRL(r.price_cents / 100)}/h</span>
              {canEdit && <><Button variant="outline" size="sm" className="h-10 sm:h-8" onClick={() => open(r)}>Editar</Button><Button variant="ghost" size="icon" className="size-10 sm:size-8" aria-label="Excluir regra" onClick={() => remove(r)}><Trash2 className="size-4" /></Button></>}</div>
          </li>
        ))}
      </ul>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
          {edit && <>
            <DialogHeader><DialogTitle>{edit.id ? "Editar regra" : "Nova regra de preço"}</DialogTitle><DialogDescription>Valor por hora aplicado quando a reserva cair nesta faixa.</DialogDescription></DialogHeader>
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="p-n">Nome da regra</Label><Input id="p-n" required minLength={2} maxLength={60} placeholder="Ex.: Noite de fim de semana" className={inp} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="p-c">Quadra</Label><NativeSelect id="p-c" className={`${inp} w-full`} value={edit.court} onChange={(e) => setEdit({ ...edit, court: e.target.value })}><option value="">Todas as quadras</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></div>
              <div className="space-y-1.5"><Label htmlFor="p-k">Tipo de reserva</Label><NativeSelect id="p-k" className={`${inp} w-full`} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}><option value="">Qualquer tipo</option><option value="avulsa">Reserva avulsa</option><option value="mensalista">Mensalista</option><option value="mensalista_professor">Mensalista com professor</option></NativeSelect></div>
              <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-medium">Dias da semana</legend>
                <div className="flex flex-wrap gap-x-3">{WEEKDAYS_SHORT.map((n, d) => <label key={d} className="flex min-h-11 items-center gap-1.5 text-sm"><input type="checkbox" className="size-5" checked={edit.days.includes(d)} onChange={() => setEdit({ ...edit, days: edit.days.includes(d) ? edit.days.filter((x) => x !== d) : [...edit.days, d] })} />{n}</label>)}</div>
                <div className="flex gap-3 text-xs"><button type="button" className="min-h-9 text-primary underline" onClick={() => setEdit({ ...edit, days: [1, 2, 3, 4, 5] })}>Dias úteis</button><button type="button" className="min-h-9 text-primary underline" onClick={() => setEdit({ ...edit, days: [0, 6] })}>Fim de semana</button><button type="button" className="min-h-9 text-primary underline" onClick={() => setEdit({ ...edit, days: [0, 1, 2, 3, 4, 5, 6] })}>Todos</button></div></fieldset>
              <div className="space-y-1.5"><Label htmlFor="p-f">Das</Label><NativeSelect id="p-f" className={`${inp} w-full`} value={edit.from} onChange={(e) => setEdit({ ...edit, from: Number(e.target.value), to: Math.max(edit.to, Number(e.target.value) + 30) })}>{opts(30, 1410).map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}</NativeSelect></div>
              <div className="space-y-1.5"><Label htmlFor="p-t">Até</Label><NativeSelect id="p-t" className={`${inp} w-full`} value={edit.to} onChange={(e) => setEdit({ ...edit, to: Number(e.target.value) })}>{opts(30, 1440, 30).filter((m) => m > edit.from).map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}</NativeSelect></div>
              <div className="space-y-1.5"><Label htmlFor="p-v">Valor por hora (R$)</Label><Input id="p-v" required inputMode="decimal" className={inp} value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="p-pr">Prioridade</Label><Input id="p-pr" inputMode="numeric" className={inp} value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })} /></div>
              <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-5" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Regra ativa</label>
              <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setEdit(null)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar regra</Button></DialogFooter>
            </form>
          </>}
        </DialogContent>
      </Dialog>
    </CardContent></Card>
  )
}

function RulesTab({ venue, canEdit, reload }: { venue: VenueRules; canEdit: boolean; reload: () => void }) {
  const [f, setF] = React.useState({ slot: String(venue.slot_minutes), minDur: String(venue.min_duration_minutes), notice: String(Math.round(venue.min_notice_minutes / 60)), advance: String(venue.max_advance_days), free: String(venue.cancel_free_hours), fee: String(venue.cancel_fee_pct) })
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const r = await supabase().from("court_venues").update({ slot_minutes: Number(f.slot), min_duration_minutes: Number(f.minDur), min_notice_minutes: Number(f.notice) * 60, max_advance_days: Number(f.advance), cancel_free_hours: Number(f.free), cancel_fee_pct: Number(f.fee) }).eq("id", venue.id)
    setBusy(false)
    if (r.error) return toast.error(r.error.message)
    toast.success("Regras salvas."); reload()
  }
  return (
    <Card><CardContent className="pt-4">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <fieldset disabled={!canEdit || busy} className="contents">
          <div className="space-y-1.5"><Label htmlFor="r-s">Tamanho do horário</Label><NativeSelect id="r-s" className={`${inp} w-full`} value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })}><option value="60">1 hora</option><option value="30">30 minutos</option></NativeSelect><p className="text-xs text-muted-foreground">As reservas começam e terminam em múltiplos deste intervalo.</p></div>
          <div className="space-y-1.5"><Label htmlFor="r-d">Duração mínima da reserva (minutos)</Label><Input id="r-d" inputMode="numeric" className={inp} value={f.minDur} onChange={(e) => setF({ ...f, minDur: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="r-n">Antecedência mínima (horas)</Label><Input id="r-n" inputMode="numeric" className={inp} value={f.notice} onChange={(e) => setF({ ...f, notice: e.target.value })} /><p className="text-xs text-muted-foreground">Vale para reservas feitas pelo jogador na página pública (próxima fase).</p></div>
          <div className="space-y-1.5"><Label htmlFor="r-a">Antecedência máxima (dias)</Label><Input id="r-a" inputMode="numeric" className={inp} value={f.advance} onChange={(e) => setF({ ...f, advance: e.target.value })} /><p className="text-xs text-muted-foreground">Também só para a página pública.</p></div>
          <div className="space-y-1.5"><Label htmlFor="r-c">Cancelamento sem custo até (horas antes)</Label><Input id="r-c" inputMode="numeric" className={inp} value={f.free} onChange={(e) => setF({ ...f, free: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="r-f">Cobrança em cancelamento tardio (%)</Label><Input id="r-f" inputMode="numeric" className={inp} value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /><p className="text-xs text-muted-foreground">Registrada nas reservas; a cobrança financeira entra com o módulo Financeiro.</p></div>
        </fieldset>
        <p className="text-xs text-muted-foreground sm:col-span-2">Fuso horário do centro: {venue.timezone}.</p>
        {canEdit && <div className="sm:col-span-2"><Button type="submit" className="h-11 w-full sm:h-9 sm:w-auto" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar regras</Button></div>}
      </form>
    </CardContent></Card>
  )
}
