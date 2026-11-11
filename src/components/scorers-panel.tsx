"use client"

import { NativeSelect } from "@/components/native-select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useOrg } from "@/hooks/use-org"
import { useRole } from "@/hooks/use-role"
import Link from "next/link"
import { MATCHES_CHANGED, brToday, shortDate } from "@/lib/matches"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Scorer, ScorerStats } from "@/lib/types"
import { cn } from "@/lib/utils"
import * as React from "react"

const REFRESH_MS = 60_000
const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase()
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const brief = (n: string) => n.replace(/^equipe\s+/i, "")

function useScorers(season: number | null) {
  const [state, setState] = React.useState<{ rows: Scorer[] | null; seasons: number[]; error: string | null }>({ rows: null, seasons: [], error: null })
  React.useEffect(() => {
    if (!supabaseConfigured) return
    let alive = true
    setState((s) => ({ ...s, rows: null }))
    async function load() {
      try {
        const sb = supabase()
        const [t, y] = await Promise.all([sb.rpc("top_scorers", { p_season: season }), sb.rpc("scorer_seasons")])
        if (t.error) throw new Error(t.error.message)
        if (y.error) throw new Error(y.error.message)
        if (alive) setState({ rows: (t.data ?? []) as Scorer[], seasons: (y.data ?? []) as number[], error: null })
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), rows: s.rows ?? [] }))
      }
    }
    const tick = () => document.visibilityState === "visible" && load()
    load()
    const t = setInterval(tick, REFRESH_MS)
    document.addEventListener("visibilitychange", tick)
    window.addEventListener(MATCHES_CHANGED, load)
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", tick); window.removeEventListener(MATCHES_CHANGED, load) }
  }, [season])
  return state
}

type OpenMatch = { id: string; match_date: string; team_a: string; team_b: string; score_a: number | null; score_b: number | null; status: string }

/** Jogos que já deveriam ter acabado mas seguem abertos: a artilharia só conta gols de jogos finalizados. */
function useOpenMatches(enabled: boolean) {
  const [rows, setRows] = React.useState<OpenMatch[]>([])
  React.useEffect(() => {
    if (!enabled || !supabaseConfigured) return
    let alive = true
    const load = () => supabase().from("matches").select("id, match_date, team_a, team_b, score_a, score_b, status")
      .in("status", ["agendado", "em_andamento"]).lte("match_date", brToday()).order("match_date", { ascending: false }).limit(3)
      .then((r) => { if (alive && !r.error) setRows((r.data ?? []) as OpenMatch[]) })
    load()
    window.addEventListener(MATCHES_CHANGED, load)
    return () => { alive = false; window.removeEventListener(MATCHES_CHANGED, load) }
  }, [enabled])
  return rows
}

function Avatar({ name, size, leader }: { name: string; size: "lg" | "md"; leader?: boolean }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full font-semibold", size === "lg" ? "size-14 text-lg" : "size-10 text-sm",
      leader ? "bg-white text-primary ring-4 ring-amber-300" : "bg-secondary text-primary")}>{initials(name)}</span>
  )
}

function StatsDialog({ athleteId, season, onClose }: { athleteId: string | null; season: number | null; onClose: () => void }) {
  const [st, setSt] = React.useState<ScorerStats | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  React.useEffect(() => {
    setSt(null); setErr(null)
    if (!athleteId) return
    let alive = true
    supabase().rpc("scorer_stats", { p_athlete: athleteId, p_season: season }).then((r) => {
      if (!alive) return
      if (r.error) setErr(r.error.message); else setSt(r.data as ScorerStats)
    })
    return () => { alive = false }
  }, [athleteId, season])
  return (
    <Dialog open={!!athleteId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>{st ? st.name : "Estatísticas"}{st && <span className="ml-2 text-sm font-normal text-muted-foreground">Temporada {st.season}</span>}</DialogTitle></DialogHeader>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        {!st && !err && <Skeleton className="h-40" />}
        {st && (
          <div className="space-y-4">
            <dl className={cn("grid gap-2 text-center", st.month_goals == null ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3")}>
              {([
                ["Gols na temporada", String(st.goals)],
                ["Partidas", String(st.games)],
                ["Média por partida", st.games ? String(st.avg).replace(".", ",") : "—"],
                ...(st.month_goals == null ? [] : [["Gols no mês", String(st.month_goals)]]),
                ["Posição", st.position ? `${st.position}º` : "—"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="rounded-xl border bg-card p-2.5">
                  <dd className="text-2xl font-bold text-primary tabular-nums">{v}</dd>
                  <dt className="text-[11px] leading-tight text-muted-foreground">{k}</dt>
                </div>
              ))}
            </dl>
            <div>
              <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Gols por partida</h3>
              {st.history.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma partida finalizada nesta temporada.</p> : (
                <ul className="divide-y rounded-xl border text-sm">
                  {st.history.map((h) => (
                    <li key={h.date + h.team_a + h.team_b + h.goals} className="flex items-center gap-2 px-3 py-2">
                      <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">{shortDate(h.date).slice(0, 5)}</span>
                      <span className="min-w-0 flex-1 truncate text-xs">{brief(h.team_a)} <span className="font-semibold tabular-nums">{h.score_a} × {h.score_b}</span> {brief(h.team_b)}</span>
                      <span className={cn("shrink-0 font-semibold tabular-nums", h.goals ? "text-primary" : "text-muted-foreground")}>{h.goals ? `⚽ ${h.goals}` : "sem gol"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Top 5 da artilharia da temporada, com detalhes por atleta ao clicar. Atualiza sozinho. */
export function ScorersCard() {
  const [season, setSeason] = React.useState<number | null>(null)
  const [open, setOpen] = React.useState<string | null>(null)
  const { rows, seasons, error } = useScorers(season)
  const org = useOrg()
  const { role } = useRole()
  const pendentes = useOpenMatches(role === "admin" || role === "diretoria")
  const current = seasons[0] ?? null
  if (!supabaseConfigured) return null
  return (
    <section aria-labelledby="pn-art" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="pn-art" className="flex items-center gap-2 text-sm font-semibold tracking-wide text-primary uppercase"><span aria-hidden>🏆</span> Artilharia{org ? ` · ${org.name}` : ""}</h2>
        {seasons.length > 1 && (
          <NativeSelect aria-label="Temporada" className="h-7 text-xs" value={season ?? current ?? ""} onChange={(e) => setSeason(Number(e.target.value) === current ? null : Number(e.target.value))}>
            {seasons.map((y) => <option key={y} value={y}>{y}</option>)}
          </NativeSelect>
        )}
      </div>
      {pendentes.length > 0 && (
        <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Jogo ainda não finalizado</p>
          <p className="mt-1">Os gols só entram na artilharia quando o jogo é <b>finalizado</b>: {pendentes.map((m) => `${shortDate(m.match_date)} (${m.team_a} ${m.score_a ?? 0} × ${m.score_b ?? 0} ${m.team_b})`).join("; ")}.</p>
          {role === "admin" ? <Link href="/jogos" className="mt-2 inline-block rounded-md bg-amber-900 px-3 py-1.5 font-medium text-white">Abrir Jogos e finalizar</Link> : <p className="mt-1">Peça ao administrador para finalizar.</p>}
        </div>
      )}
      {error && !rows?.length && <p role="alert" className="text-sm text-destructive">Não foi possível carregar a artilharia: {error}</p>}
      {rows === null && !error && <div className="space-y-2"><Skeleton className="h-24" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
      {rows && rows.length === 0 && !error && <p className="rounded-xl border border-dashed p-3 text-center text-sm text-muted-foreground">Ainda não há gols registrados nesta temporada. ⚽</p>}
      {rows && rows.length > 0 && (
        <ol className="space-y-2">
          {rows.map((r) => {
            const lead = r.pos === 1, podium = r.pos <= 3
            return (
              <li key={r.athlete_id}>
                <button
                  type="button" onClick={() => setOpen(r.athlete_id)}
                  aria-label={`${r.pos}º lugar: ${r.display_name}, ${plural(r.goals, "gol", "gols")}. Ver estatísticas`}
                  className={cn("flex w-full items-center gap-3 rounded-xl border text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
                    lead ? "bg-gradient-to-br from-[#1E3A5F] to-[#2A5A8C] p-3.5 text-white shadow-md hover:shadow-lg" : podium ? "bg-card p-2.5 shadow-sm hover:bg-secondary" : "bg-card px-2.5 py-2 hover:bg-secondary")}
                >
                  {podium ? <Avatar name={r.display_name} size={lead ? "lg" : "md"} leader={lead} /> : <span aria-hidden className="grid size-7 shrink-0 place-items-center text-sm font-semibold text-muted-foreground">{r.pos}º</span>}
                  <span className="min-w-0 flex-1">
                    {lead && <span className="block text-[11px] font-semibold tracking-wide text-amber-300 uppercase">Líder da artilharia</span>}
                    <span className={cn("block truncate", lead ? "text-base font-semibold" : "text-sm font-medium")}>{podium && <span aria-hidden className="mr-1">{MEDAL[r.pos]}</span>}{r.display_name}</span>
                    <span className={cn("block text-xs", lead ? "text-blue-100" : "text-muted-foreground")}>{plural(r.games, "partida", "partidas")}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={cn("block font-bold tabular-nums", lead ? "text-3xl" : "text-xl text-primary")}>{r.goals}</span>
                    <span className={cn("block text-[11px]", lead ? "text-blue-100" : "text-muted-foreground")}>{r.goals === 1 ? "gol" : "gols"}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      <StatsDialog athleteId={open} season={season} onClose={() => setOpen(null)} />
    </section>
  )
}
