"use client"

import { SetupNotice } from "@/components/setup-notice"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useLoad } from "@/hooks/use-load"
import { hhmm, MATCHES_CHANGED, shortDate } from "@/lib/matches"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Match } from "@/lib/types"
import { Loader2, Play, Undo2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Ath = { id: string; full_name: string; nickname: string | null }
type Side = "a" | "b"
/** Um gol marcado nesta tela (para poder desfazer). athlete null = gol contra / sem autor. */
type Goal = { side: Side; athlete: string | null }
type Data = { matches: Match[]; athletes: Ath[]; goals: Record<string, number> }

const shown = (a: Ath) => a.nickname || a.full_name
const MAX_GOALS = 30

async function load(): Promise<Data> {
  const db = supabase()
  const [m, a] = await Promise.all([
    db.from("matches").select("*").in("status", ["agendado", "em_andamento"]).order("match_date", { ascending: true }).order("match_time", { ascending: true, nullsFirst: false }),
    db.from("athletes").select("id, full_name, nickname").eq("active", true).order("full_name"),
  ])
  if (m.error) throw new Error(m.error.message)
  if (a.error) throw new Error(a.error.message)
  const matches = m.data as Match[]
  const live = matches.find((x) => x.status === "em_andamento")
  const goals: Record<string, number> = {}
  if (live) {
    const p = await db.from("match_players").select("athlete_id, goals").eq("match_id", live.id)
    if (p.error) throw new Error(p.error.message)
    for (const r of p.data as { athlete_id: string; goals: number }[]) goals[r.athlete_id] = r.goals
  }
  return { matches, athletes: a.data as Ath[], goals }
}

export default function LivePage() {
  const { data, error, loading, reload } = useLoad(load, [])
  const [picking, setPicking] = React.useState<Side | null>(null)
  const [history, setHistory] = React.useState<Goal[]>([])
  const [busy, setBusy] = React.useState(false)
  if (!supabaseConfigured) return <SetupNotice />

  const live = data?.matches.find((m) => m.status === "em_andamento") ?? null
  const upcoming = data?.matches.filter((m) => m.status === "agendado") ?? []
  const changed = () => { reload(); window.dispatchEvent(new Event(MATCHES_CHANGED)) }

  async function start(m: Match) {
    setBusy(true)
    const { error } = await supabase().from("matches").update({ status: "em_andamento", score_a: m.score_a ?? 0, score_b: m.score_b ?? 0 }).eq("id", m.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    setHistory([])
    changed()
  }

  /** Soma (ou tira) 1 gol do placar da equipe e do atleta. Só grava se o placar ainda for o que a tela mostra. */
  async function apply(g: Goal, delta: 1 | -1) {
    if (!live || busy) return
    const col = g.side === "a" ? "score_a" : "score_b"
    const cur = live[col] ?? 0
    const next = cur + delta
    if (next < 0) return toast.error("O placar já está zerado.")
    const db = supabase()
    const goals = data!.goals
    const had = g.athlete ? (goals[g.athlete] ?? 0) : 0
    const hadNext = had + delta
    if (g.athlete && hadNext > MAX_GOALS) return toast.error(`Máximo de ${MAX_GOALS} gols por atleta.`)
    setBusy(true)
    const setScore = async (to: number, from: number) => {
      const r = await db.from("matches").update({ [col]: to }).eq("id", live.id).eq(col, from).select("id")
      if (r.error) return r.error.message
      if (!r.data?.length) return "O placar mudou em outro aparelho. Tela atualizada, tente de novo."
    }
    const setAthlete = async (n: number) => {
      const r = n <= 0 && delta < 0
        ? await db.from("match_players").delete().eq("match_id", live.id).eq("athlete_id", g.athlete!)
        : await db.from("match_players").upsert({ match_id: live.id, athlete_id: g.athlete!, goals: n }, { onConflict: "match_id,athlete_id" })
      return r.error?.message
    }
    let err: string | undefined
    // A trava do banco exige: placar sobe antes dos gols do atleta, e gols do atleta descem antes do placar.
    if (delta === 1) {
      err = await setScore(next, cur)
      if (!err && g.athlete) {
        err = await setAthlete(hadNext)
        if (err) await setScore(cur, next)
      }
    } else {
      if (g.athlete) err = await setAthlete(hadNext)
      if (!err) {
        err = await setScore(next, cur)
        if (err && g.athlete) await setAthlete(had)
      }
    }
    setBusy(false)
    if (err) { toast.error(err); reload(); return }
    setHistory((h) => (delta === 1 ? [...h, g] : h.slice(0, -1)))
    changed()
  }

  async function finish() {
    if (!live) return
    if (!window.confirm(`Finalizar o jogo em ${live.score_a ?? 0} × ${live.score_b ?? 0}? A artilharia será atualizada.`)) return
    setBusy(true)
    const { error } = await supabase().from("matches").update({ status: "finalizado" }).eq("id", live.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Jogo finalizado.")
    setHistory([])
    changed()
  }

  const last = history[history.length - 1]
  const name = (id: string | null) => (id ? shown(data!.athletes.find((a) => a.id === id) ?? { id, full_name: "?", nickname: null }) : "gol contra")

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Gols ao vivo</h1>
      {error && <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>}
      {loading && !data && <Skeleton className="h-60" />}

      {data && !live && (
        <Card><CardContent className="space-y-3 pt-4">
          {upcoming.length === 0
            ? <p className="text-sm text-muted-foreground">Nenhum jogo agendado. Cadastre o jogo em “Jogos” e volte aqui.</p>
            : <>
              <p className="text-sm text-muted-foreground">Escolha o jogo para começar a marcar os gols:</p>
              {upcoming.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                  <div><div className="font-medium">{m.team_a} × {m.team_b}</div>
                    <div className="text-xs text-muted-foreground">{shortDate(m.match_date)}{hhmm(m.match_time) ? ` · ${hhmm(m.match_time)}` : ""}</div></div>
                  <Button variant="brand" disabled={busy} onClick={() => start(m)}><Play /> Iniciar</Button>
                </div>
              ))}
            </>}
        </CardContent></Card>
      )}

      {data && live && (
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl border bg-card p-4 text-center">
            <div className="truncate text-sm font-medium">{live.team_a}</div><div />
            <div className="truncate text-sm font-medium">{live.team_b}</div>
            <div className="text-6xl font-bold tabular-nums text-primary">{live.score_a ?? 0}</div>
            <div className="text-2xl text-muted-foreground">×</div>
            <div className="text-6xl font-bold tabular-nums text-primary">{live.score_b ?? 0}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="brand" className="h-20 text-base whitespace-normal" disabled={busy} onClick={() => setPicking("a")}>⚽ Gol<br />{live.team_a}</Button>
            <Button variant="brand" className="h-20 text-base whitespace-normal" disabled={busy} onClick={() => setPicking("b")}>⚽ Gol<br />{live.team_b}</Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" disabled={!last || busy} onClick={() => last && apply(last, -1)}>
              {busy ? <Loader2 className="animate-spin" /> : <Undo2 />} Desfazer{last ? `: ${name(last.athlete)}` : ""}
            </Button>
            <Button variant="outline" disabled={busy} onClick={finish}>Finalizar jogo</Button>
          </div>
          <p className="text-xs text-muted-foreground">Para corrigir gols de antes ou incluir quem jogou sem marcar, use “Jogos → Editar”.</p>
        </div>
      )}

      <Dialog open={!!picking && !!live} onOpenChange={(o) => !o && setPicking(null)}>
        <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
          <DialogHeader><DialogTitle>Quem fez o gol{live && picking ? ` (${picking === "a" ? live.team_a : live.team_b})` : ""}?</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {data?.athletes.map((a) => (
              <Button key={a.id} variant="outline" className="h-12 justify-between" disabled={busy}
                onClick={async () => { const s = picking!; setPicking(null); await apply({ side: s, athlete: a.id }, 1) }}>
                <span className="truncate">{shown(a)}</span>
                {(data.goals[a.id] ?? 0) > 0 && <span className="text-xs text-muted-foreground">⚽{data.goals[a.id]}</span>}
              </Button>
            ))}
            <Button variant="ghost" className="col-span-2 h-12" disabled={busy}
              onClick={async () => { const s = picking!; setPicking(null); await apply({ side: s, athlete: null }, 1) }}>
              Gol contra / sem autor
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
