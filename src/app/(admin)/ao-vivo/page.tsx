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
import { ptCompare } from "@/lib/format"
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
  return { matches, athletes: (a.data as Ath[]).sort((x, y) => ptCompare(shown(x), shown(y))), goals }
}

export default function LivePage() {
  const { data, error, loading, reload } = useLoad(load, [])
  const [picking, setPicking] = React.useState<Side | null>(null)
  const [removing, setRemoving] = React.useState<string | null>(null) // atleta cujo gol será tirado (pergunta a equipe)
  const [swapping, setSwapping] = React.useState<string | null>(null) // atleta cujo gol será passado para outro
  const [history, setHistory] = React.useState<Goal[]>([])
  const [busy, setBusy] = React.useState(false)
  // Jogo em andamento: mantém a tela acesa (celular no campo não pode apagar) e religa ao voltar para a aba.
  const playing = !!data?.matches.some((m) => m.status === "em_andamento")
  React.useEffect(() => {
    if (!playing || !("wakeLock" in navigator)) return
    let lock: WakeLockSentinel | null = null, gone = false
    const ask = () => navigator.wakeLock.request("screen").then((l) => { if (gone) l.release(); else lock = l }).catch(() => {})
    ask()
    const onVis = () => document.visibilityState === "visible" && ask()
    document.addEventListener("visibilitychange", onVis)
    return () => { gone = true; document.removeEventListener("visibilitychange", onVis); lock?.release().catch(() => {}) }
  }, [playing])

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
  async function apply(g: Goal, delta: 1 | -1, fromUndo = false) {
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
    navigator.vibrate?.(delta === 1 ? 40 : [20, 40, 20])   // confirma o toque sem olhar para a tela
    setHistory((h) => (delta === 1 ? [...h, g] : fromUndo ? h.slice(0, -1) : []))
    changed()
  }

  /** Corrige o autor: passa 1 gol de um atleta para outro, sem mexer no placar. */
  async function swap(from: string, to: string) {
    if (!live || busy) return
    const goals = data!.goals
    const a = goals[from] ?? 0, b = goals[to] ?? 0
    if (a < 1) return
    if (b + 1 > MAX_GOALS) return toast.error(`Máximo de ${MAX_GOALS} gols por atleta.`)
    const db = supabase()
    setBusy(true)
    const first = a - 1 <= 0
      ? await db.from("match_players").delete().eq("match_id", live.id).eq("athlete_id", from)
      : await db.from("match_players").upsert({ match_id: live.id, athlete_id: from, goals: a - 1 }, { onConflict: "match_id,athlete_id" })
    let err = first.error?.message
    if (!err) {
      err = (await db.from("match_players").upsert({ match_id: live.id, athlete_id: to, goals: b + 1 }, { onConflict: "match_id,athlete_id" })).error?.message
      if (err) await db.from("match_players").upsert({ match_id: live.id, athlete_id: from, goals: a }, { onConflict: "match_id,athlete_id" })
    }
    setBusy(false)
    if (err) { toast.error(err); reload(); return }
    setHistory([])
    toast.success("Autor do gol corrigido.")
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

  const scorers = (data?.athletes ?? []).filter((a) => (data?.goals[a.id] ?? 0) > 0)
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
            <div className="text-sm leading-tight font-medium break-words">{live.team_a}</div><div />
            <div className="text-sm leading-tight font-medium break-words">{live.team_b}</div>
            <div className="text-7xl font-bold tabular-nums text-primary sm:text-6xl">{live.score_a ?? 0}</div>
            <div className="text-2xl text-muted-foreground">×</div>
            <div className="text-7xl font-bold tabular-nums text-primary sm:text-6xl">{live.score_b ?? 0}</div>
          </div>

          <div className="sticky bottom-3 z-10 grid grid-cols-2 gap-3 rounded-2xl bg-background/90 p-2 shadow-lg backdrop-blur max-sm:pb-[max(.5rem,env(safe-area-inset-bottom))] sm:static sm:bg-transparent sm:p-0 sm:shadow-none">
            <Button variant="brand" className="h-24 text-base whitespace-normal sm:h-20" disabled={busy} onClick={() => setPicking("a")}>⚽ Gol<br />{live.team_a}</Button>
            <Button variant="brand" className="h-24 text-base whitespace-normal sm:h-20" disabled={busy} onClick={() => setPicking("b")}>⚽ Gol<br />{live.team_b}</Button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
            <Button variant="outline" className="h-11 sm:h-auto" disabled={!last || busy} onClick={() => last && apply(last, -1, true)}>
              {busy ? <Loader2 className="animate-spin" /> : <Undo2 />} Desfazer{last ? `: ${name(last.athlete)}` : ""}
            </Button>
            <Button variant="outline" className="h-11 sm:h-auto" disabled={busy} onClick={finish}>Finalizar jogo</Button>
          </div>
          {scorers.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold tracking-wide text-primary uppercase">Corrigir gols (Diretoria)</h2>
              <ul className="divide-y rounded-xl border">
                {scorers.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-0 basis-full truncate text-sm font-medium sm:basis-0 sm:flex-1">{shown(a)} <span className="text-muted-foreground">⚽ {data.goals[a.id]}</span></span>
                    <Button variant="outline" size="sm" className="max-sm:h-10 max-sm:flex-1" disabled={busy} onClick={() => setSwapping(a.id)}>Trocar autor</Button>
                    <Button variant="outline" size="sm" className="max-sm:h-10 max-sm:flex-1" disabled={busy} onClick={() => setRemoving(a.id)}>Excluir 1 gol</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Para corrigir gols de antes ou incluir quem jogou sem marcar, use “Jogos → Editar”.</p>
        </div>
      )}

      <Dialog open={!!picking && !!live} onOpenChange={(o) => !o && setPicking(null)}>
        <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
          <DialogHeader><DialogTitle>Quem fez o gol{live && picking ? ` (${picking === "a" ? live.team_a : live.team_b})` : ""}?</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {data?.athletes.map((a) => (
              <Button key={a.id} variant="outline" className="h-14 justify-between sm:h-12" disabled={busy}
                onClick={async () => { const s = picking!; setPicking(null); await apply({ side: s, athlete: a.id }, 1) }}>
                <span className="truncate">{shown(a)}</span>
                {(data.goals[a.id] ?? 0) > 0 && <span className="text-xs text-muted-foreground">⚽{data.goals[a.id]}</span>}
              </Button>
            ))}
            <Button variant="ghost" className="col-span-2 h-14 sm:h-12" disabled={busy}
              onClick={async () => { const s = picking!; setPicking(null); await apply({ side: s, athlete: null }, 1) }}>
              Gol contra / sem autor
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing && !!live} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir 1 gol de {removing ? name(removing) : ""}: de qual equipe era?</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">O placar dessa equipe também diminui 1.</p>
          <div className="grid grid-cols-2 gap-2">
            {live && (["a", "b"] as Side[]).map((sd) => (
              <Button key={sd} variant="outline" className="h-14 whitespace-normal" disabled={busy || (sd === "a" ? live.score_a : live.score_b) === 0}
                onClick={async () => { const id = removing!; setRemoving(null); await apply({ side: sd, athlete: id }, -1) }}>
                {sd === "a" ? live.team_a : live.team_b}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!swapping && !!live} onOpenChange={(o) => !o && setSwapping(null)}>
        <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
          <DialogHeader><DialogTitle>Quem fez o gol de verdade? (tirar de {swapping ? name(swapping) : ""})</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {data?.athletes.filter((a) => a.id !== swapping).map((a) => (
              <Button key={a.id} variant="outline" className="h-12" disabled={busy}
                onClick={async () => { const f = swapping!; setSwapping(null); await swap(f, a.id) }}>
                <span className="truncate">{shown(a)}</span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
