"use client"

import { KIND_STYLE, STATUS_LABEL, bookingTitle, layoutLanes, type Booking, type Court, type Hours, type Venue } from "@/lib/court-booking"
import { WEEKDAYS_SHORT, addDays, dowOf, fmtMinutes, fmtRange, localParts, startOfMonth, startOfWeek, todayIn } from "@/lib/court-time"
import { cn } from "@/lib/utils"
import * as React from "react"

const PX = 1   // 1 minuto = 1 px (1 hora = 60 px)
const COL_W = 56

export type GridCol = { key: string; label: string; sub?: string; date: string; courtId: string | null }

/** Janelas de funcionamento de uma quadra num dia da semana (a quadra com horários próprios ignora o padrão do centro). */
export function windowsOf(hours: Hours[], courtId: string | null, dow: number) {
  const act = hours.filter((h) => h.active)
  const own = courtId ? act.filter((h) => h.court_id === courtId) : []
  const pool = courtId && act.some((h) => h.court_id === courtId) ? own : act.filter((h) => h.court_id === null)
  return pool.filter((h) => h.weekday === dow).map((h) => [h.opens_min, h.closes_min] as const).sort((a, b) => a[0] - b[0])
}
const inside = (w: (readonly [number, number])[], m: number) => w.some(([a, b]) => m >= a && m < b)

/** Quantos horários livres restam (dentro do funcionamento, sem reserva ativa). */
export function freeSlots(venue: Venue, hours: Hours[], bookings: Booking[], courtId: string, date: string) {
  const w = windowsOf(hours, courtId, dowOf(date)), tz = venue.timezone
  const busy = bookings.filter((b) => b.court_id === courtId && b.status !== "cancelada").map((b) => { const s = localParts(tz, b.starts_at), e = localParts(tz, b.ends_at); return s.date === date ? [s.minutes, e.date === date ? e.minutes : 1440] : null }).filter(Boolean) as number[][]
  let n = 0
  for (const [a, z] of w) for (let m = a; m + venue.slot_minutes <= z; m += venue.slot_minutes) if (!busy.some(([s, e]) => m < e && s < m + venue.slot_minutes)) n++
  return n
}

export function Legend() {
  const items: [keyof typeof KIND_STYLE, string][] = [["avulsa", "Reserva avulsa"], ["mensalista", "Mensalista"], ["mensalista_professor", "Mensalista com professor"], ["bloqueio", "Manutenção, torneios e bloqueios"]]
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
      {items.map(([k, l]) => <li key={k} className="flex items-center gap-1.5"><span aria-hidden className={cn("size-3 rounded-sm border", KIND_STYLE[k].box)} />{l}</li>)}
      <li className="flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm border border-dashed border-foreground/40" />Pendente</li>
      <li className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-red-500" />Em aberto <span aria-hidden className="size-2 rounded-full bg-amber-500" />Parcial <span aria-hidden className="size-2 rounded-full bg-green-600" />Pago</li>
    </ul>
  )
}

/** Grade de horários (dia ou semana): colunas = quadras (dia) ou dias (semana); reservas viram blocos coloridos. */
export function TimeGrid({ cols, bookings, venue, hours, courtsById, showCourt, canBook, onSlot, onOpen, minColW = 130 }: {
  cols: GridCol[]; bookings: Booking[]; venue: Venue; hours: Hours[]; courtsById: Map<string, Court>; showCourt: boolean; canBook: boolean
  onSlot: (c: GridCol, minute: number) => void; onOpen: (b: Booking) => void; minColW?: number
}) {
  const tz = venue.timezone, slot = venue.slot_minutes
  const parts = React.useMemo(() => bookings.map((b) => { const s = localParts(tz, b.starts_at), e = localParts(tz, b.ends_at); return { b, date: s.date, s: s.minutes, e: e.date === s.date ? e.minutes : 1440 } }), [bookings, tz])
  // Faixa vertical: do menor horário de abertura (ou reserva) ao maior fechamento (ou fim de reserva)
  const { gs, ge } = React.useMemo(() => {
    let lo = 1440, hi = 0
    for (const c of cols) for (const [a, z] of windowsOf(hours, c.courtId, dowOf(c.date))) { lo = Math.min(lo, a); hi = Math.max(hi, z) }
    for (const p of parts) { lo = Math.min(lo, p.s); hi = Math.max(hi, p.e) }
    if (lo >= hi) { lo = 480; hi = 1380 }
    return { gs: Math.floor(lo / 60) * 60, ge: Math.min(1440, Math.ceil(hi / 60) * 60) }
  }, [cols, hours, parts])
  const height = (ge - gs) * PX
  const today = todayIn(tz), nowMin = localParts(tz, new Date()).minutes
  const hoursList = Array.from({ length: Math.ceil((ge - gs) / 60) }, (_, i) => gs + i * 60)

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div style={{ minWidth: COL_W + cols.length * minColW }}>
        <div className="sticky top-0 z-10 flex border-b bg-card">
          <div style={{ width: COL_W }} className="shrink-0" />
          {cols.map((c) => <div key={c.key} className="min-w-0 flex-1 border-l px-2 py-2 text-center"><div className={cn("truncate text-sm font-semibold", c.date === today && c.courtId === null && "text-primary")}>{c.label}</div>{c.sub && <div className="truncate text-xs text-muted-foreground">{c.sub}</div>}</div>)}
        </div>
        <div className="flex" style={{ height }}>
          <div style={{ width: COL_W }} className="relative shrink-0">
            {hoursList.map((m) => <div key={m} style={{ top: (m - gs) * PX }} className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums first:translate-y-0">{fmtMinutes(m)}</div>)}
          </div>
          {cols.map((c) => {
            const w = windowsOf(hours, c.courtId, dowOf(c.date))
            const items = parts.filter((p) => p.date === c.date && (c.courtId === null || p.b.court_id === c.courtId))
            const laneItems = items.map((p) => ({ s: p.s, e: p.e, p }))
            const lanes = layoutLanes(laneItems)
            const closed: [number, number][] = []
            if (c.courtId || !showCourt) { let cur = gs; for (const [a, z] of w) { if (a > cur) closed.push([cur, a]); cur = Math.max(cur, z) } if (cur < ge) closed.push([cur, ge]) }
            return (
              <div key={c.key} className={cn("relative min-w-0 flex-1 border-l", canBook && "cursor-pointer hover:bg-primary/[.03]")} style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 59px, rgb(0 0 0 / .07) 59px, rgb(0 0 0 / .07) 60px)" }}
                onClick={(e) => { if (!canBook) return; const y = e.clientY - e.currentTarget.getBoundingClientRect().top; const m = gs + Math.floor(y / PX / slot) * slot; if (inside(w, m)) onSlot(c, m) }}>
                {closed.map(([a, z], i) => <div key={i} aria-hidden style={{ top: (a - gs) * PX, height: (z - a) * PX }} className="pointer-events-none absolute inset-x-0 bg-slate-200/60 [background-image:repeating-linear-gradient(135deg,transparent,transparent_6px,rgb(0_0_0/.05)_6px,rgb(0_0_0/.05)_12px)]" />)}
                {c.date === today && nowMin >= gs && nowMin <= ge && <div aria-hidden style={{ top: (nowMin - gs) * PX }} className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500" />}
                {laneItems.map((li) => {
                  const lane = lanes.get(li)!, p = li.p
                  const b = p.b, st = KIND_STYLE[b.kind], cancelled = b.status === "cancelada"
                  const h = Math.max((p.e - p.s) * PX, 22)
                  return (
                    <button key={b.id} type="button" onClick={(e) => { e.stopPropagation(); onOpen(b) }}
                      style={{ top: (p.s - gs) * PX + 1, height: h - 2, left: `calc(${(lane.lane / lane.of) * 100}% + 2px)`, width: `calc(${100 / lane.of}% - 4px)` }}
                      className={cn("absolute z-10 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs leading-tight shadow-sm outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring", st.box, b.status === "pendente" && "border-dashed", cancelled && "opacity-50 line-through")}
                      aria-label={`${bookingTitle(b)}, ${fmtRange(tz, b.starts_at, b.ends_at)}, ${STATUS_LABEL[b.status]}`}>
                      <span className="block truncate font-semibold">{bookingTitle(b)}</span>
                      <span className="block truncate opacity-80">{fmtRange(tz, b.starts_at, b.ends_at)}{showCourt ? ` · ${courtsById.get(b.court_id)?.name ?? ""}` : ""}</span>
                      {h >= 54 && b.kind !== "bloqueio" && <span className="mt-0.5 flex items-center gap-1 truncate"><span aria-hidden className={cn("size-2 shrink-0 rounded-full", b.payment_status === "pago" ? "bg-green-600" : b.payment_status === "parcial" ? "bg-amber-500" : "bg-red-500")} />{b.status === "pendente" ? "Pendente" : b.status === "concluida" ? "Concluída" : b.status === "nao_compareceu" ? "Não compareceu" : ""}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Visão mensal: cada dia mostra quantas reservas há por categoria; clicar abre o dia. */
export function MonthGrid({ date, bookings, venue, onDay }: { date: string; bookings: Booking[]; venue: Venue; onDay: (d: string) => void }) {
  const tz = venue.timezone, today = todayIn(tz)
  const first = startOfMonth(date), gridStart = startOfWeek(first)
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const by = new Map<string, Record<string, number>>()
  for (const b of bookings) { if (b.status === "cancelada") continue; const d = localParts(tz, b.starts_at).date; const r = by.get(d) ?? {}; r[b.kind] = (r[b.kind] ?? 0) + 1; by.set(d, r) }
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b bg-secondary/50 text-center text-xs font-medium">{WEEKDAYS_SHORT.map((d) => <div key={d} className="py-2">{d}</div>)}</div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const r = by.get(d) ?? {}, total = Object.values(r).reduce((a, b) => a + b, 0), other = d.slice(0, 7) !== first.slice(0, 7)
            return (
              <button key={d} type="button" onClick={() => onDay(d)} className={cn("min-h-24 border-b border-l p-1.5 text-left transition hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", other && "bg-secondary/30 text-muted-foreground")} aria-label={`${d.split("-").reverse().join("/")}: ${total} reserva(s)`}>
                <span className={cn("inline-grid size-7 place-items-center rounded-full text-sm", d === today && "bg-primary text-primary-foreground font-bold")}>{Number(d.slice(8))}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {(["avulsa", "mensalista", "mensalista_professor", "bloqueio"] as const).filter((k) => r[k]).map((k) => <span key={k} className={cn("rounded px-1.5 text-xs font-medium", KIND_STYLE[k].box)}>{r[k]}</span>)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Lista do dia (celular): reservas agrupadas por quadra, em ordem de horário. */
export function DayList({ date, bookings, venue, courts, onOpen, onSlot, canBook, hours }: { date: string; bookings: Booking[]; venue: Venue; courts: Court[]; onOpen: (b: Booking) => void; onSlot: (courtId: string) => void; canBook: boolean; hours: Hours[] }) {
  const tz = venue.timezone
  return (
    <div className="space-y-4">
      {courts.map((c) => {
        const list = bookings.filter((b) => b.court_id === c.id && localParts(tz, b.starts_at).date === date).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        const free = freeSlots(venue, hours, bookings, c.id, date)
        return (
          <section key={c.id} className="rounded-xl border bg-card p-3" aria-label={c.name}>
            <div className="mb-2 flex items-center justify-between gap-2"><h3 className="font-semibold">{c.name}</h3><span className="text-xs text-muted-foreground">{free} horário(s) livre(s)</span></div>
            {list.length === 0 && <p className="text-sm text-muted-foreground">Sem reservas neste dia.</p>}
            <ul className="space-y-2">{list.map((b) => (
              <li key={b.id}><button type="button" onClick={() => onOpen(b)} className={cn("flex min-h-12 w-full items-start gap-2 rounded-lg border-l-4 p-2 text-left text-sm", KIND_STYLE[b.kind].box, b.status === "pendente" && "border-dashed", b.status === "cancelada" && "opacity-50 line-through")}>
                <span className="w-24 shrink-0 font-semibold tabular-nums">{fmtRange(tz, b.starts_at, b.ends_at)}</span><span className="min-w-0 flex-1"><span className="block truncate font-medium">{bookingTitle(b)}</span><span className="block text-xs opacity-80">{STATUS_LABEL[b.status]}</span></span></button></li>
            ))}</ul>
            {canBook && free > 0 && <button type="button" onClick={() => onSlot(c.id)} className="mt-2 min-h-11 w-full rounded-lg border border-dashed text-sm font-medium text-primary hover:bg-primary/5">+ Reservar nesta quadra</button>}
          </section>
        )
      })}
    </div>
  )
}
