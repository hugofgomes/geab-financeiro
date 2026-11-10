"use client"

import { NativeSelect } from "@/components/native-select"
import { SetupNotice } from "@/components/setup-notice"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useLoad } from "@/hooks/use-load"
import { useOrg } from "@/hooks/use-org"
import { kitDataUrl } from "@/lib/kit"
import { CARD_SIZE, canvasToBlob, drawLineupCard, type CardFormat, type CardPlayer } from "@/lib/lineup-card"
import { autoDistribute, cardLabels, shownName, whatsappMessage, type LineupAthlete, type LineupEntry, type LineupTeam } from "@/lib/lineup"
import { hhmm, shortDate, splitMatches } from "@/lib/matches"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Match } from "@/lib/types"
import { Download, Lock, LockOpen, Loader2, Share2, Shuffle, Sparkles } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Zone = "pool" | LineupTeam
type Counts = Record<string, { a: number; b: number; reserva: number }>
type Data = { matches: Match[]; athletes: LineupAthlete[]; counts: Counts; lineupsReady: boolean }

async function load(): Promise<Data> {
  const db = supabase()
  const [m, a, l] = await Promise.all([
    db.from("matches").select("*").order("match_date", { ascending: false }).order("match_time", { ascending: false, nullsFirst: false }),
    db.from("athletes").select("id, full_name, nickname").eq("active", true).order("full_name"),
    db.from("match_lineups").select("match_id, team"),
  ])
  if (m.error) throw new Error(m.error.message)
  if (a.error) throw new Error(a.error.message)
  const counts: Counts = {}
  for (const r of (l.data ?? []) as { match_id: string; team: LineupTeam }[]) {
    const c = (counts[r.match_id] ??= { a: 0, b: 0, reserva: 0 })
    c[r.team]++
  }
  return { matches: m.data as Match[], athletes: a.data as LineupAthlete[], counts, lineupsReady: !l.error }
}

const matchLabel = (m: Match) => `${shortDate(m.match_date)}${hhmm(m.match_time) ? ` ${hhmm(m.match_time)}` : ""} · ${m.team_a} × ${m.team_b}`

export default function LineupPage() {
  const org = useOrg()
  const { data, error, loading, reload } = useLoad(load, [])
  const [tab, setTab] = React.useState<"montar" | "historico">("montar")
  const [matchId, setMatchId] = React.useState<string | null>(null)
  const [entries, setEntries] = React.useState<LineupEntry[]>([])
  const [keep, setKeep] = React.useState<Set<string>>(new Set())
  const [sel, setSel] = React.useState<Set<string>>(new Set())
  const [venue, setVenue] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [loadingLineup, setLoadingLineup] = React.useState(false)
  const [showCard, setShowCard] = React.useState(false)
  const [format, setFormat] = React.useState<CardFormat>("vertical")
  const [hover, setHover] = React.useState<Zone | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  const match = data?.matches.find((m) => m.id === matchId) ?? null
  const locked = !!match?.lineup_confirmed
  const byId = React.useMemo(() => new Map((data?.athletes ?? []).map((a) => [a.id, a])), [data])

  // Escolhe o jogo inicial: o próximo agendado ou o mais recente.
  React.useEffect(() => {
    if (!data || matchId) return
    const first = splitMatches(data.matches).next ?? data.matches[0]
    if (first) setMatchId(first.id)
  }, [data, matchId])

  // Carrega a escalação salva do jogo escolhido.
  React.useEffect(() => {
    if (!matchId) return
    let alive = true
    setLoadingLineup(true); setShowCard(false); setSel(new Set())
    supabase().from("match_lineups").select("athlete_id, team, is_keeper, shirt_number").eq("match_id", matchId).order("sort_order").then((r) => {
      if (!alive) return
      setLoadingLineup(false)
      if (r.error) { setEntries([]); setKeep(new Set()); return }
      const rows = r.data as { athlete_id: string; team: LineupTeam; is_keeper: boolean; shirt_number: number | null }[]
      setEntries(rows.map((x) => ({ athlete_id: x.athlete_id, team: x.team, is_keeper: x.is_keeper, shirt_number: x.shirt_number == null ? "" : String(x.shirt_number) })))
      setKeep(new Set(rows.filter((x) => x.is_keeper).map((x) => x.athlete_id)))
    })
    return () => { alive = false }
  }, [matchId])
  React.useEffect(() => { setVenue(match?.venue ?? "") }, [match?.id, match?.venue])

  const inTeam = (t: LineupTeam) => entries.filter((e) => e.team === t)
  const assigned = new Set(entries.map((e) => e.athlete_id))
  const pool = (data?.athletes ?? []).filter((a) => !assigned.has(a.id))

  const labels = React.useMemo(() => cardLabels(entries.map((e) => byId.get(e.athlete_id)).filter((a): a is LineupAthlete => !!a)), [entries, byId])
  const toPlayers = React.useCallback((t: LineupTeam): CardPlayer[] =>
    entries.filter((e) => e.team === t).map((e) => ({ name: labels.get(e.athlete_id) ?? "?", keeper: keep.has(e.athlete_id), number: e.shirt_number }))
      .sort((x, y) => Number(y.keeper) - Number(x.keeper)), [entries, keep, labels])

  // Redesenha a prévia (o mesmo canvas que será exportado).
  React.useEffect(() => {
    if (!showCard || !match || !canvasRef.current) return
    let alive = true
    drawLineupCard(canvasRef.current, { orgName: org?.name ?? "", tagline: org?.tagline ?? null, website: org?.website ?? null, logoUrl: org?.logo_url ?? null, format, date: match.match_date, time: match.match_time, venue: venue || match.venue || null, azul: toPlayers("a"), branco: toPlayers("b"), reservas: toPlayers("reserva") })
      .catch((e) => alive && toast.error(e instanceof Error ? e.message : "Erro ao desenhar o card"))
    return () => { alive = false }
  }, [showCard, match, format, venue, toPlayers, org])

  if (!supabaseConfigured) return <SetupNotice />

  function move(id: string, zone: Zone) {
    if (locked) return toast.error("Escalação confirmada. Reabra a edição para alterar.")
    setEntries((list) => {
      const rest = list.filter((e) => e.athlete_id !== id)
      if (zone === "pool") return rest
      const old = list.find((e) => e.athlete_id === id)
      return [...rest, { athlete_id: id, team: zone, is_keeper: keep.has(id), shirt_number: old?.shirt_number ?? "" }]
    })
    setSel((s) => { const n = new Set(s); n.delete(id); return n })
  }
  const toggleKeeper = (id: string) => !locked && setKeep((k) => { const n = new Set(k); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const setNumber = (id: string, v: string) => setEntries((l) => l.map((e) => e.athlete_id === id ? { ...e, shirt_number: v.replace(/\D/g, "").slice(0, 2) } : e))

  function distribute() {
    if (locked) return toast.error("Escalação confirmada. Reabra a edição para alterar.")
    const ids = [...sel].filter((id) => !assigned.has(id))
    if (!ids.length) return toast.error("Marque na lista os atletas que vão jogar.")
    setEntries((l) => autoDistribute(ids, keep, l))
    setSel(new Set())
  }

  async function save(): Promise<boolean> {
    if (!match) return false
    setBusy(true)
    const rows = entries.map((e) => ({ athlete_id: e.athlete_id, team: e.team, is_keeper: keep.has(e.athlete_id), shirt_number: e.shirt_number }))
    const db = supabase()
    let err = (await db.rpc("set_match_lineup", { p_match: match.id, p_rows: rows })).error?.message
    if (!err && venue.trim() !== (match.venue ?? "")) err = (await db.from("matches").update({ venue: venue.trim() || null }).eq("id", match.id)).error?.message
    setBusy(false)
    if (err) { toast.error(err.includes("set_match_lineup") || err.includes("venue") ? "Rode a migration 0015_lineups.sql no Supabase. " + err : err); return false }
    toast.success("Escalação salva.")
    reload()
    return true
  }

  async function setConfirmed(v: boolean) {
    if (!match) return
    if (v && !(await save())) return
    setBusy(true)
    const { error } = await supabase().from("matches").update({ lineup_confirmed: v }).eq("id", match.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(v ? "Escalação confirmada." : "Edição reaberta.")
    reload()
  }

  async function copyFrom(srcId: string, targetId = matchId) {
    const r = await supabase().from("match_lineups").select("athlete_id, team, is_keeper, shirt_number").eq("match_id", srcId).order("sort_order")
    if (r.error) return toast.error(r.error.message)
    const rows = r.data as { athlete_id: string; team: LineupTeam; is_keeper: boolean; shirt_number: number | null }[]
    const active = new Set((data?.athletes ?? []).map((a) => a.id))
    const kept = rows.filter((x) => active.has(x.athlete_id))   // atletas inativos ficam de fora
    if (targetId && targetId !== matchId) setMatchId(targetId)
    // Aguarda o efeito que carrega a escalação do jogo escolhido e então aplica a cópia.
    setTimeout(() => {
      setEntries(kept.map((x) => ({ athlete_id: x.athlete_id, team: x.team, is_keeper: x.is_keeper, shirt_number: x.shirt_number == null ? "" : String(x.shirt_number) })))
      setKeep(new Set(kept.filter((x) => x.is_keeper).map((x) => x.athlete_id)))
      toast.success(`Escalação copiada (${kept.length} atletas). Clique em Salvar para gravar.`)
    }, 400)
  }

  const fileName = () => `escalacao-geab-${match?.match_date}-${format}.png`
  async function download() {
    if (!canvasRef.current) return
    try {
      const blob = await canvasToBlob(canvasRef.current)
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob); a.download = fileName(); a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro ao gerar a imagem") }
  }
  const message = () => match ? whatsappMessage({ match_date: match.match_date, match_time: match.match_time, venue: venue || match.venue }, org?.name ?? "GEAB Futebol") : ""
  async function share() {
    if (!canvasRef.current || !match) return
    try {
      const blob = await canvasToBlob(canvasRef.current)
      const file = new File([blob], fileName(), { type: "image/png" })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: message(), title: `Escalação ${org?.name ?? ""}` })
      } else {
        await download()
        try { await navigator.clipboard.writeText(message()) } catch { /* sem permissão de área de transferência */ }
        toast.message("Este aparelho não compartilha imagem direto. A imagem foi baixada e a mensagem copiada: anexe no WhatsApp.")
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return
      toast.error(e instanceof Error ? e.message : "Erro ao compartilhar")
    }
  }
  async function copyMessage() {
    try { await navigator.clipboard.writeText(message()); toast.success("Mensagem copiada.") } catch { toast.error("Não foi possível copiar.") }
  }

  /* ───────── peças da tela ───────── */
  const Kit = ({ color, n }: { color: "azul" | "branco"; n?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={kitDataUrl(color, n || null)} alt="" width={26} height={34} className="h-[34px] w-[26px] shrink-0" />
  )
  const dnd = (id: string) => ({
    draggable: !locked,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move" },
  })
  const zoneProps = (z: Zone) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setHover(z) },
    onDragLeave: () => setHover((h) => (h === z ? null : h)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setHover(null); const id = e.dataTransfer.getData("text/plain"); if (id) move(id, z) },
  })
  const zoneCls = (z: Zone) => `min-h-24 space-y-1.5 rounded-xl border p-2 transition-colors ${hover === z ? "border-primary bg-secondary" : "bg-card"}`

  const teamRow = (e: LineupEntry, color: "azul" | "branco" | null) => {
    const a = byId.get(e.athlete_id)
    if (!a) return null
    const other: LineupTeam = e.team === "a" ? "b" : "a"
    return (
      <div key={e.athlete_id} {...dnd(e.athlete_id)} className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-background px-1.5 py-1 cursor-grab">
        {color ? <Kit color={color} n={e.shirt_number} /> : <span className="w-[26px]" />}
        <span className="min-w-0 flex-1 basis-28 truncate text-sm">{shownName(a)}</span>
        <Input aria-label={`Número de ${shownName(a)}`} className="h-10 w-14 px-1 text-center md:h-7 md:w-11 md:text-xs" inputMode="numeric" placeholder="Nº" value={e.shirt_number} disabled={locked} onChange={(ev) => setNumber(e.athlete_id, ev.target.value)} />
        <Button type="button" size="icon-sm" variant={keep.has(e.athlete_id) ? "brand" : "outline"} aria-label="Goleiro" title="Goleiro" disabled={locked} onClick={() => toggleKeeper(e.athlete_id)}>G</Button>
        {e.team !== "reserva" && <Button type="button" size="icon-sm" variant="outline" aria-label={`Mover para ${other === "a" ? "Azul" : "Branco"}`} title={`Mover para ${other === "a" ? "Azul" : "Branco"}`} disabled={locked} onClick={() => move(e.athlete_id, other)}>{other === "a" ? "A" : "B"}</Button>}
        {e.team !== "reserva" ? <Button type="button" size="icon-sm" variant="outline" aria-label="Reserva" title="Reserva" disabled={locked} onClick={() => move(e.athlete_id, "reserva")}>R</Button>
          : <><Button type="button" size="icon-sm" variant="outline" aria-label="Time Azul" title="Time Azul" disabled={locked} onClick={() => move(e.athlete_id, "a")}>A</Button>
            <Button type="button" size="icon-sm" variant="outline" aria-label="Time Branco" title="Time Branco" disabled={locked} onClick={() => move(e.athlete_id, "b")}>B</Button></>}
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Remover da escalação" title="Remover" disabled={locked} onClick={() => move(e.athlete_id, "pool")}>✕</Button>
      </div>
    )
  }

  const nA = inTeam("a").length, nB = inTeam("b").length, nR = inTeam("reserva").length
  const withLineup = (data?.matches ?? []).filter((m) => data?.counts[m.id])
  const otherLineups = withLineup.filter((m) => m.id !== matchId)

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Escalação dos Jogos</h1>
      {error && <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>}
      {loading && !data && <Skeleton className="h-60" />}
      {data && !data.lineupsReady && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          A escalação ainda não está habilitada no banco. Rode o arquivo <b>supabase/migrations/0015_lineups.sql</b> no SQL Editor do Supabase e recarregue.
        </p>
      )}

      {data && (
        <>
          <div className="flex gap-2">
            <Button variant={tab === "montar" ? "brand" : "outline"} onClick={() => setTab("montar")}>Montar escalação</Button>
            <Button variant={tab === "historico" ? "brand" : "outline"} onClick={() => setTab("historico")}>Histórico ({withLineup.length})</Button>
          </div>

          {tab === "historico" && (
            <Card><CardContent className="space-y-2 pt-4">
              {withLineup.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma escalação salva ainda.</p>}
              {withLineup.map((m) => {
                const c = data.counts[m.id]
                const nextFree = [...data.matches].filter((x) => x.status === "agendado" && x.id !== m.id && !data.counts[x.id]).sort((p, q) => p.match_date.localeCompare(q.match_date))[0]
                return (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
                    <div>
                      <div className="text-sm font-medium">{matchLabel(m)} {m.lineup_confirmed && <span className="text-xs text-muted-foreground">· confirmada</span>}</div>
                      <div className="text-xs text-muted-foreground">Azul {c.a} · Branco {c.b}{c.reserva ? ` · ${c.reserva} reserva(s)` : ""}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setMatchId(m.id); setTab("montar"); setShowCard(false) }}>Abrir / gerar card</Button>
                      <Button size="sm" variant="outline" onClick={() => nextFree ? (copyFrom(m.id, nextFree.id), setTab("montar")) : toast.error("Cadastre o próximo jogo em Jogos para duplicar a escalação.")}>Duplicar para o próximo jogo</Button>
                    </div>
                  </div>
                )
              })}
            </CardContent></Card>
          )}

          {tab === "montar" && (
            <>
              <Card><CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="em">Jogo</Label>
                  <NativeSelect id="em" className="w-full" value={matchId ?? ""} onChange={(e) => setMatchId(e.target.value)}>
                    {data.matches.length === 0 && <option value="">Nenhum jogo cadastrado</option>}
                    {data.matches.map((m) => <option key={m.id} value={m.id}>{matchLabel(m)}{data.counts[m.id] ? " ✓" : ""}</option>)}
                  </NativeSelect></div>
                <div className="space-y-1.5"><Label htmlFor="ev">Local da partida</Label>
                  <Input id="ev" maxLength={120} placeholder="Ex.: Arena do grupo" value={venue} disabled={locked} onChange={(e) => setVenue(e.target.value)} /></div>
                {match && <p className="text-sm text-muted-foreground sm:col-span-2"><b>Escalação oficial {org?.name}</b> · {shortDate(match.match_date)} · {hhmm(match.match_time) ?? "horário a definir"} · {venue || "local a definir"} · Azul <b>{nA}</b> × Branco <b>{nB}</b>{nR ? ` · ${nR} reserva(s)` : ""}</p>}
                {locked && <p className="flex items-center gap-1.5 text-sm font-medium text-primary sm:col-span-2"><Lock className="size-4" /> Escalação confirmada. Para editar, reabra a edição.</p>}
              </CardContent></Card>

              {!match && <p className="text-sm text-muted-foreground">Cadastre um jogo em “Jogos” para montar a escalação.</p>}
              {match && (loadingLineup ? <Skeleton className="h-40" /> : (
                <>
                  <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
                    <section aria-label="Time Azul" className="space-y-2">
                      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary"><span className="size-3 rounded-full bg-blue-600" /> Time Azul · {nA}</h2>
                      <div className={zoneCls("a")} {...zoneProps("a")}>
                        {inTeam("a").map((e) => teamRow(e, "azul"))}
                        {nA === 0 && <p className="p-2 text-center text-xs text-muted-foreground">Arraste ou envie atletas para cá</p>}
                      </div>
                    </section>
                    <section aria-label="Time Branco" className="space-y-2">
                      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary"><span className="size-3 rounded-full bg-white ring-1 ring-slate-400" /> Time Branco · {nB}</h2>
                      <div className={zoneCls("b")} {...zoneProps("b")}>
                        {inTeam("b").map((e) => teamRow(e, "branco"))}
                        {nB === 0 && <p className="p-2 text-center text-xs text-muted-foreground">Arraste ou envie atletas para cá</p>}
                      </div>
                    </section>
                    <section aria-label="Reservas" className="space-y-2">
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Reservas · {nR}</h2>
                      <div className={zoneCls("reserva")} {...zoneProps("reserva")}>
                        {inTeam("reserva").map((e) => teamRow(e, null))}
                        {nR === 0 && <p className="p-2 text-center text-xs text-muted-foreground">Sem reservas</p>}
                      </div>
                    </section>
                  </div>

                  <section aria-label="Atletas disponíveis" className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Atletas cadastrados ({pool.length})</h2>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={locked} onClick={() => setSel(new Set(pool.map((a) => a.id)))}>Marcar todos</Button>
                        <Button size="sm" variant="outline" disabled={locked || !sel.size} onClick={() => setSel(new Set())}>Limpar</Button>
                        <Button size="sm" variant="brand" disabled={locked || !sel.size} onClick={distribute}><Shuffle /> Distribuir {sel.size ? `${sel.size} ` : ""}automaticamente</Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Marque quem vai jogar e use a distribuição automática, ou arraste/envie cada atleta manualmente. Use <b>G</b> para goleiro (a distribuição coloca um de cada lado).</p>
                    <div className={zoneCls("pool")} {...zoneProps("pool")}>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {pool.map((a) => (
                          <div key={a.id} {...dnd(a.id)} className="flex cursor-grab flex-wrap items-center gap-2 rounded-lg border bg-background px-2 py-1">
                            <label className="-m-1 grid size-10 shrink-0 cursor-pointer place-items-center">
                              <input type="checkbox" className="size-5" aria-label={`Selecionar ${shownName(a)}`} checked={sel.has(a.id)} disabled={locked}
                                onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n })} />
                            </label>
                            <span className="min-w-0 flex-1 basis-32 truncate text-sm">{shownName(a)}{a.nickname && <span className="text-xs text-muted-foreground"> · {a.full_name}</span>}</span>
                            <div className="flex w-full gap-2 sm:w-auto">
                              <Button type="button" size="sm" variant={keep.has(a.id) ? "brand" : "outline"} aria-label="Goleiro" title="Goleiro" className="w-12 sm:w-auto" disabled={locked} onClick={() => toggleKeeper(a.id)}>G</Button>
                              <Button type="button" size="sm" variant="outline" className="flex-1 sm:flex-none" disabled={locked} onClick={() => move(a.id, "a")}>Azul</Button>
                              <Button type="button" size="sm" variant="outline" className="flex-1 sm:flex-none" disabled={locked} onClick={() => move(a.id, "b")}>Branco</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {pool.length === 0 && <p className="p-2 text-center text-xs text-muted-foreground">Todos os atletas ativos já estão na escalação.</p>}
                    </div>
                  </section>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" disabled={busy || locked} onClick={save}>{busy && <Loader2 className="animate-spin" />} Salvar escalação</Button>
                    {locked
                      ? <Button variant="outline" disabled={busy} onClick={() => setConfirmed(false)}><LockOpen /> Reabrir edição</Button>
                      : <Button variant="outline" disabled={busy || entries.length === 0} onClick={() => setConfirmed(true)}><Lock /> Confirmar escalação</Button>}
                    {otherLineups.length > 0 && !locked && (
                      <NativeSelect aria-label="Copiar escalação de outro jogo" className="h-8 max-w-64" value="" onChange={(e) => e.target.value && copyFrom(e.target.value)}>
                        <option value="">Copiar escalação de…</option>
                        {otherLineups.map((m) => <option key={m.id} value={m.id}>{matchLabel(m)}</option>)}
                      </NativeSelect>
                    )}
                  </div>

                  <Button variant="brand" className="h-14 w-full text-base font-bold tracking-wide" disabled={nA + nB === 0} onClick={() => setShowCard(true)}>
                    <Sparkles /> GERAR CARD DA ESCALAÇÃO
                  </Button>

                  {showCard && (
                    <Card><CardContent className="space-y-3 pt-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <NativeSelect aria-label="Formato" className="h-8" value={format} onChange={(e) => setFormat(e.target.value as CardFormat)}>
                          <option value="vertical">Vertical {CARD_SIZE.vertical.w}×{CARD_SIZE.vertical.h}</option>
                          <option value="quadrado">Quadrado {CARD_SIZE.quadrado.w}×{CARD_SIZE.quadrado.h}</option>
                        </NativeSelect>
                        <Button variant="outline" onClick={download}><Download /> Baixar PNG</Button>
                        <Button variant="brand" onClick={share}><Share2 /> Compartilhar no WhatsApp</Button>
                        <Button variant="ghost" onClick={copyMessage}>Copiar mensagem</Button>
                      </div>
                      <canvas ref={canvasRef} className="mx-auto h-auto w-full max-w-md rounded-xl border" aria-label="Prévia do card da escalação" />
                    </CardContent></Card>
                  )}
                </>
              ))}
            </>
          )}
        </>
      )}
    </>
  )
}
