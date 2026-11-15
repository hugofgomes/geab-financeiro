"use client"

import { NativeSelect } from "@/components/native-select"
import { BlockDialog, BookingFormDialog, DetailDialog, type Ctx } from "@/components/quadra/booking-dialogs"
import { DayList, Legend, MonthGrid, TimeGrid, freeSlots, type GridCol } from "@/components/quadra/agenda"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { SPORTS, useCourtRoleCtx } from "@/hooks/use-court-role"
import { useCourtData } from "@/hooks/use-court-data"
import { KIND_LABEL, STATUS_LABEL, type Booking } from "@/lib/court-booking"
import { MONTHS, WEEKDAYS_SHORT, addDays, addMonths, fmtDateLong, startOfMonth, startOfWeek, todayIn, zonedToUtc } from "@/lib/court-time"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight, Lock, Plus } from "lucide-react"
import Link from "next/link"
import * as React from "react"

type View = "dia" | "semana" | "mes"

export default function AgendaPage() {
  const role = useCourtRoleCtx()!
  const [chosen, setView] = React.useState<View | null>(null)
  const [date, setDate] = React.useState<string | null>(null)
  const [f, setF] = React.useState({ court: "", sport: "", kind: "", status: "", cancelled: false })
  const [form, setForm] = React.useState<{ open: boolean; initial?: { courtId?: string; date?: string; startMin?: number; endMin?: number } }>({ open: false })
  const [block, setBlock] = React.useState<{ open: boolean; initial?: { courtId?: string; date?: string } }>({ open: false })
  const [detail, setDetail] = React.useState<Booking | null>(null)
  const [edit, setEdit] = React.useState<Booking | null>(null)
  const [narrow, setNarrow] = React.useState(false)
  const view: View = chosen ?? (narrow ? "dia" : "semana")   // no celular a visão padrão é a lista do dia
  React.useEffect(() => { const q = window.matchMedia("(max-width: 639px)"); const on = () => setNarrow(q.matches); on(); q.addEventListener("change", on); return () => q.removeEventListener("change", on) }, [])

  const range = React.useCallback((tz: string) => {
    const d = date ?? todayIn(tz)
    const a = view === "dia" ? d : view === "semana" ? startOfWeek(d) : startOfWeek(startOfMonth(d))
    const n = view === "dia" ? 1 : view === "semana" ? 7 : 42
    return { from: zonedToUtc(tz, a, 0).toISOString(), to: zonedToUtc(tz, addDays(a, n), 0).toISOString() }
  }, [date, view])
  const { data, error, loading, reload } = useCourtData(range, [view, date], f.cancelled)

  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading && !data) return <Skeleton className="h-96" />
  if (!data) return null
  const { venue, courts, hours } = data
  if (!venue) return <Empty text="Cadastre o centro esportivo para usar a agenda." href="/quadra/centro" label="Ir para o Centro Esportivo" />
  const activeCourts = courts.filter((c) => c.active)
  if (activeCourts.length === 0) return <Empty text="Cadastre ao menos uma quadra ativa para usar a agenda." href="/quadra/centro" label="Cadastrar quadras" />
  if (!hours.some((h) => h.active)) return <Empty text="Configure os horários de funcionamento para liberar a agenda." href="/quadra/configuracoes" label="Configurar horários" />

  const tz = venue.timezone, today = todayIn(tz), d = date ?? today
  const canBook = role === "admin" || role === "gerente" || role === "recepcionista"
  const canBlock = role === "admin" || role === "gerente"
  const ctx: Ctx = { venue, courts, role, reload }
  const courtsById = new Map(courts.map((c) => [c.id, c]))
  const bookings = data.bookings.filter((b) => (!f.sport || b.sport === f.sport) && (!f.kind || b.kind === f.kind) && (!f.status || b.status === f.status) && (!f.court || b.court_id === f.court))
  const shownCourts = f.court ? activeCourts.filter((c) => c.id === f.court) : activeCourts

  const go = (n: number) => setDate(view === "dia" ? addDays(d, n) : view === "semana" ? addDays(d, 7 * n) : addMonths(d, n))
  const week = startOfWeek(d)
  const title = view === "dia" ? fmtDateLong(d) : view === "semana" ? `${Number(week.slice(8))} ${MONTHS[Number(week.slice(5, 7)) - 1].slice(0, 3).toLowerCase()} – ${Number(addDays(week, 6).slice(8))} ${MONTHS[Number(addDays(week, 6).slice(5, 7)) - 1].slice(0, 3).toLowerCase()} ${addDays(week, 6).slice(0, 4)}` : `${MONTHS[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`

  const dayCols: GridCol[] = shownCourts.map((c) => ({ key: c.id, label: c.name, sub: `${freeSlots(venue, hours, data.bookings, c.id, d)} livre(s)`, date: d, courtId: c.id }))
  const weekCols: GridCol[] = Array.from({ length: 7 }, (_, i) => { const day = addDays(week, i); return { key: day, label: `${WEEKDAYS_SHORT[i]} ${Number(day.slice(8))}`, sub: day === today ? "hoje" : undefined, date: day, courtId: f.court || null } })
  const openSlot = (c: GridCol, minute: number) => setForm({ open: true, initial: { courtId: c.courtId ?? (f.court || activeCourts[0].id), date: c.date, startMin: minute } })

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold tracking-tight">Agenda de Quadras</h1><p className="text-sm text-muted-foreground">Clique num horário livre para reservar. Atualiza sozinha.</p></div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {canBook && <Button className="h-11 flex-1 sm:h-9 sm:flex-none" onClick={() => setForm({ open: true, initial: { date: d, courtId: f.court || undefined } })}><Plus /> Nova reserva</Button>}
          {canBlock && <Button variant="outline" className="h-11 flex-1 sm:h-9 sm:flex-none" onClick={() => setBlock({ open: true, initial: { date: d, courtId: f.court || undefined } })}><Lock /> Bloquear horário</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Visualização" className="inline-flex rounded-lg bg-secondary p-1">
          {(["dia", "semana", "mes"] as const).map((v) => <button key={v} role="tab" aria-selected={view === v} type="button" onClick={() => setView(v)} className={cn("min-h-10 rounded-md px-4 text-sm font-medium capitalize sm:min-h-8", view === v ? "bg-card shadow-sm" : "text-muted-foreground")}>{v === "mes" ? "Mês" : v === "dia" ? "Dia" : "Semana"}</button>)}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-10 sm:size-9" aria-label="Anterior" onClick={() => go(-1)}><ChevronLeft /></Button>
          <Button variant="outline" className="h-10 sm:h-9" onClick={() => setDate(null)}>Hoje</Button>
          <Button variant="outline" size="icon" className="size-10 sm:size-9" aria-label="Próximo" onClick={() => go(1)}><ChevronRight /></Button>
        </div>
        <Input type="date" aria-label="Ir para a data" className="h-10 w-auto sm:h-9" value={d} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <span className="w-full text-sm font-medium capitalize sm:w-auto">{title}</span>
      </div>

      <details className="rounded-xl border bg-card px-3 py-1 sm:hidden"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Filtros</summary><div className="grid gap-2 pb-3"><Filters f={f} setF={setF} courts={activeCourts} /></div></details>
      <div className="hidden flex-wrap items-center gap-2 sm:flex"><Filters f={f} setF={setF} courts={activeCourts} /></div>
      <Legend />

      {view === "mes" && <MonthGrid date={d} bookings={bookings} venue={venue} onDay={(x) => { setDate(x); setView("dia") }} />}
      {view === "dia" && (narrow
        ? <DayList date={d} bookings={bookings} venue={venue} hours={hours} courts={shownCourts} canBook={canBook} onOpen={setDetail} onSlot={(courtId) => setForm({ open: true, initial: { courtId, date: d } })} />
        : <TimeGrid cols={dayCols} bookings={bookings} venue={venue} hours={hours} courtsById={courtsById} showCourt={false} canBook={canBook} onSlot={openSlot} onOpen={setDetail} minColW={150} />)}
      {view === "semana" && <TimeGrid cols={weekCols} bookings={bookings} venue={venue} hours={hours} courtsById={courtsById} showCourt={!f.court} canBook={canBook} onSlot={openSlot} onOpen={setDetail} minColW={110} />}
      {!f.court && view === "semana" && <p className="text-xs text-muted-foreground">Dica: escolha uma quadra no filtro para ver os horários fechados da quadra sombreados.</p>}

      <BookingFormDialog open={form.open} onClose={() => setForm({ open: false })} ctx={ctx} initial={form.initial} />
      <BookingFormDialog open={!!edit} onClose={() => setEdit(null)} ctx={ctx} editing={edit} />
      <BlockDialog open={block.open} onClose={() => setBlock({ open: false })} ctx={ctx} initial={block.initial} />
      <DetailDialog booking={detail} onClose={() => setDetail(null)} ctx={ctx} onEdit={(b) => { setDetail(null); setEdit(b) }} />
    </>
  )
}

function Filters({ f, setF, courts }: { f: { court: string; sport: string; kind: string; status: string; cancelled: boolean }; setF: (x: typeof f) => void; courts: { id: string; name: string }[] }) {
  const sel = "h-10 w-full sm:h-9 sm:w-auto"
  return (
    <>
      <NativeSelect aria-label="Quadra" className={sel} value={f.court} onChange={(e) => setF({ ...f, court: e.target.value })}><option value="">Todas as quadras</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
      <NativeSelect aria-label="Modalidade" className={sel} value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })}><option value="">Todas as modalidades</option>{SPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
      <NativeSelect aria-label="Categoria" className={sel} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">Todas as categorias</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
      <NativeSelect aria-label="Situação" className={sel} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Todas as situações</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="size-5 sm:size-4" checked={f.cancelled} onChange={(e) => setF({ ...f, cancelled: e.target.checked })} /> Mostrar canceladas</label>
    </>
  )
}

function Empty({ text, href, label }: { text: string; href: string; label: string }) {
  return <div className="mx-auto mt-10 max-w-md space-y-3 rounded-2xl border bg-card p-6 text-center"><p className="text-sm">{text}</p><Link href={href} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">{label}</Link></div>
}

