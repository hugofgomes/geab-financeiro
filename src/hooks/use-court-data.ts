"use client"

import { useLoad } from "@/hooks/use-load"
import type { Booking, Court, Hours, Venue } from "@/lib/court-booking"
import { supabase } from "@/lib/supabase/client"
import * as React from "react"

export type CourtData = { venue: Venue | null; courts: Court[]; hours: Hours[]; bookings: Booking[] }
const VENUE_COLS = "id, trade_name, timezone, slot_minutes, min_duration_minutes, min_notice_minutes, max_advance_days, cancel_free_hours, cancel_fee_pct"

/** Centro, quadras, horários e as reservas do período (a função `range` recebe o fuso do centro e devolve o intervalo em ISO). */
export function useCourtData(range: (tz: string) => { from: string; to: string }, deps: React.DependencyList, withCancelled: boolean) {
  const r = useLoad<CourtData>(async () => {
    const sb = supabase()
    const v = await sb.from("court_venues").select(VENUE_COLS).maybeSingle()
    if (v.error) throw new Error(v.error.message)
    const venue = v.data as Venue | null
    if (!venue) return { venue: null, courts: [], hours: [], bookings: [] }
    const { from, to } = range(venue.timezone)
    let bq = sb.from("court_bookings").select("*").gte("starts_at", from).lt("starts_at", to).order("starts_at").limit(2000)
    if (!withCancelled) bq = bq.neq("status", "cancelada")
    const [c, h, b] = await Promise.all([sb.from("court_courts").select("id, name, sport, active, price_cents").order("sort_order").order("name"), sb.from("court_hours").select("id, court_id, weekday, opens_min, closes_min, active"), bq])
    for (const x of [c, h, b]) if (x.error) throw new Error(x.error.message)
    return { venue, courts: c.data as Court[], hours: h.data as Hours[], bookings: b.data as Booking[] }
  }, [...deps, withCancelled])
  // Atualiza sozinho: a cada minuto e ao voltar para a aba (outro funcionário pode ter reservado).
  const reloadRef = React.useRef(r.reload)
  reloadRef.current = r.reload
  React.useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && reloadRef.current(), 60_000)
    const v = () => document.visibilityState === "visible" && reloadRef.current()
    document.addEventListener("visibilitychange", v)
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", v) }
  }, [])
  return r
}
