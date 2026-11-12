"use client"

import { useLoad } from "@/hooks/use-load"
import { brCodeForAmount } from "@/lib/brcode"
import { MATCHES_CHANGED } from "@/lib/matches"
import { supabase } from "@/lib/supabase/client"
import type { Athlete, Charge, Match, MonthBirthday, Payment, PixCharge, Scorer, ScorerStats } from "@/lib/types"
import QRCode from "qrcode"
import * as React from "react"

/** Dados do próprio atleta (as regras de acesso do banco devolvem só o que é dele). */
export function useAthleteData() {
  return useLoad(async () => {
    const sb = supabase()
    const [a, c, p, x, st] = await Promise.all([
      sb.from("athletes").select("*").single(),
      sb.from("charges_view").select("*").order("competence", { ascending: false }),
      sb.from("payments").select("*").order("paid_at", { ascending: false }),
      sb.from("pix_charges").select("*").eq("status", "ativa").order("created_at", { ascending: false }),
      sb.from("app_settings").select("value").eq("key", "pix_br_code").maybeSingle(),
    ])
    for (const r of [a, c, p, x]) if (r.error) throw new Error(r.error.message)
    const pix = new Map<string, PixCharge>()
    for (const q of x.data as PixCharge[]) if (!pix.has(q.charge_id) && (!q.expires_at || new Date(q.expires_at) > new Date())) pix.set(q.charge_id, q)
    return { athlete: a.data as Athlete, charges: c.data as Charge[], payments: p.data as Payment[], pix, staticCode: (st.data?.value as string | undefined) ?? null }
  }, [])
}
export type AthleteData = NonNullable<ReturnType<typeof useAthleteData>["data"]>

/** Opção de pagamento Pix de uma mensalidade em aberto (Pix gerado pelo grupo ou código estático com o valor exato). */
export type PixOption = { chargeId: string; competence: string; cents: number; code: string | null; qr: string | null; link: string | null; confirmedAuto: boolean }

export function usePixOptions(data: AthleteData | null) {
  const [staticPix, setStaticPix] = React.useState<PixOption[]>([])
  React.useEffect(() => {
    if (!data?.staticCode) { setStaticPix([]); return }
    let alive = true
    const open = data.charges.filter((c) => c.balance > 0 && !data.pix.has(c.id))
    Promise.all(open.map(async (c): Promise<PixOption | null> => {
      const cents = Math.round(c.balance * 100)
      const code = brCodeForAmount(data.staticCode!, cents, "GEAB" + c.id.replace(/-/g, "").slice(0, 12))
      return code ? { chargeId: c.id, competence: c.competence, cents, code, qr: await QRCode.toDataURL(code, { margin: 1, width: 240 }), link: null, confirmedAuto: false } : null
    })).then((r) => alive && setStaticPix(r.filter((x): x is PixOption => !!x)))
    return () => { alive = false }
  }, [data])
  return React.useMemo(() => {
    const map = new Map<string, PixOption>()
    if (data) {
      for (const c of data.charges) {
        const q = data.pix.get(c.id)
        if (c.balance > 0 && q) map.set(c.id, { chargeId: c.id, competence: c.competence, cents: q.value_cents, code: q.br_code, qr: q.qr_image, link: q.payment_link, confirmedAuto: true })
      }
    }
    for (const s of staticPix) if (!map.has(s.chargeId)) map.set(s.chargeId, s)
    return map
  }, [data, staticPix])
}

export type MyGame = { match: Match; goals: number; team: "a" | "b" | "reserva" | null }
type PlayerRow = { goals: number; matches: Match | Match[] | null }

export type Extras = {
  matches: Match[]
  birthdays: MonthBirthday[]
  games: MyGame[]
  lineups: Map<string, "a" | "b" | "reserva">
  stats: ScorerStats | null
  top: Scorer[]
  failed: boolean
}

/** Jogos, desempenho, ranking e aniversariantes. Uma parte que falhe não derruba o resto da tela. */
export function useExtras(athleteId: string | undefined) {
  const r = useLoad(async (): Promise<Extras | null> => {
    if (!athleteId) return null
    const sb = supabase()
    const [m, b, p, l, s, t] = await Promise.all([
      sb.from("matches").select("id, match_date, match_time, team_a, team_b, score_a, score_b, status, venue")
        .order("match_date", { ascending: false }).order("match_time", { ascending: false, nullsFirst: false }).limit(60),
      sb.rpc("month_birthdays"),
      sb.from("match_players").select("goals, matches!inner(id, match_date, match_time, team_a, team_b, score_a, score_b, status)")
        .eq("athlete_id", athleteId).eq("matches.status", "finalizado"),
      sb.from("match_lineups").select("match_id, team").eq("athlete_id", athleteId),
      sb.rpc("scorer_stats", { p_athlete: athleteId, p_season: null }),
      sb.rpc("top_scorers", { p_season: null }),
    ])
    const lineups = new Map<string, "a" | "b" | "reserva">()
    for (const x of (l.data ?? []) as { match_id: string; team: "a" | "b" | "reserva" }[]) lineups.set(x.match_id, x.team)
    const games: MyGame[] = ((p.data ?? []) as unknown as PlayerRow[]).flatMap((row) => {
      const match = Array.isArray(row.matches) ? row.matches[0] : row.matches
      return match ? [{ match, goals: row.goals ?? 0, team: lineups.get(match.id) ?? null }] : []
    }).sort((x, y) => (y.match.match_date + (y.match.match_time ?? "")).localeCompare(x.match.match_date + (x.match.match_time ?? "")))
    return {
      matches: (m.data ?? []) as Match[],
      birthdays: (b.data ?? []) as MonthBirthday[],
      games, lineups,
      stats: (s.error ? null : s.data) as ScorerStats | null,
      top: (t.error ? [] : t.data ?? []) as Scorer[],
      failed: [m, b, p, s, t].some((x) => x.error),
    }
  }, [athleteId])
  // Atualiza quando a Diretoria salva um jogo e ao voltar para a aba.
  const reloadRef = React.useRef(r.reload)
  reloadRef.current = r.reload
  React.useEffect(() => {
    const now = () => reloadRef.current()
    const visible = () => document.visibilityState === "visible" && reloadRef.current()
    window.addEventListener(MATCHES_CHANGED, now)
    document.addEventListener("visibilitychange", visible)
    const t = setInterval(visible, 60_000)
    return () => { window.removeEventListener(MATCHES_CHANGED, now); document.removeEventListener("visibilitychange", visible); clearInterval(t) }
  }, [])
  return r
}
