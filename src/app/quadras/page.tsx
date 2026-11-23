"use client"
/* eslint-disable @next/next/no-img-element -- logotipos e fotos vêm do armazenamento do próprio centro */

import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SPORTS, sportLabel } from "@/hooks/use-court-role"
import { formatBRL } from "@/lib/format"
import { supabase } from "@/lib/supabase/client"
import { addDays, todayIn } from "@/lib/court-time"
import Link from "next/link"
import * as React from "react"

type Result = { slug: string; name: string; city: string | null; state: string | null; logo_url: string | null; sports: string[]; min_price_cents: number | null; free_slots: number | null }
const UF = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]
const BANDS: [string, string, number | null, number | null][] = [["", "Qualquer horário", null, null], ["m", "Manhã (até 12h)", 0, 720], ["t", "Tarde (12h às 18h)", 720, 1080], ["n", "Noite (18h em diante)", 1080, 1440]]

/** Jogador procura quadras por modalidade, cidade e (opcional) dia e período com horário livre. */
export default function BuscaQuadras() {
  const today = React.useMemo(() => todayIn("America/Sao_Paulo"), [])
  const [f, setF] = React.useState({ sport: "", city: "", state: "", date: "", band: "" })
  const [res, setRes] = React.useState<Result[] | null>(null)
  const [err, setErr] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { document.title = "Encontre quadras · Partidou" }, [])
  async function search(e?: React.FormEvent) {
    e?.preventDefault(); setBusy(true); setErr("")
    const b = BANDS.find((x) => x[0] === f.band)!
    const r = await supabase().rpc("court_public_search", { p_sport: f.sport || null, p_city: f.city || null, p_state: f.state || null, p_date: f.date || null, p_from_min: f.date ? b[2] : null, p_to_min: f.date ? b[3] : null })
    setBusy(false)
    if (r.error) { setErr("Não foi possível buscar agora. Tente novamente."); return }
    setRes((r.data ?? []) as Result[])
  }
  React.useEffect(() => { void search() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="quadra-theme min-h-dvh bg-background text-foreground">
      <header className="bg-primary px-4 py-5 text-primary-foreground"><div className="mx-auto max-w-4xl"><div className="flex items-center justify-between gap-3"><img src="/brand/partidou-logo.png" alt="Partidou" className="h-9 w-auto" /><Link href="/login" className="text-sm font-medium underline">Sou um centro esportivo · Entrar</Link></div><h1 className="text-xl font-semibold tracking-tight">Encontre onde jogar</h1><p className="text-sm opacity-90">Veja quadras, horários livres e solicite sua reserva.</p></div></header>
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <form onSubmit={search} className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="s">Modalidade</Label><NativeSelect id="s" value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })}><option value="">Todas</option>{SPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="c">Cidade</Label><Input id="c" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="Ex.: Joinville" /></div>
          <div className="space-y-1"><Label htmlFor="u">Estado</Label><NativeSelect id="u" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="">Todos</option>{UF.map((u) => <option key={u}>{u}</option>)}</NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="d">Dia (opcional)</Label><Input id="d" type="date" min={today} max={addDays(today, 90)} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="b">Período</Label><NativeSelect id="b" disabled={!f.date} value={f.band} onChange={(e) => setF({ ...f, band: e.target.value })}>{BANDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></div>
          <div className="flex items-end"><Button type="submit" className="h-10 w-full" disabled={busy}>{busy ? "Buscando..." : "Buscar quadras"}</Button></div>
        </form>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        {res && res.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum centro encontrado com esses filtros.</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {(res ?? []).map((r) => (
            <li key={r.slug}><Link href={`/quadras/${r.slug}${f.date ? `?data=${f.date}` : ""}`} className="flex h-full items-center gap-3 rounded-2xl border bg-card p-4 hover:border-primary">
              {r.logo_url ? <img src={r.logo_url} alt="" className="size-14 shrink-0 rounded-xl object-cover" /> : <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">{r.name.slice(0, 1)}</span>}
              <span className="min-w-0"><span className="block truncate font-semibold">{r.name}</span><span className="block text-sm text-muted-foreground">{[r.city, r.state].filter(Boolean).join("/")}</span>
                <span className="block text-xs text-muted-foreground">{r.sports.map(sportLabel).join(", ")}{r.min_price_cents != null && ` · a partir de ${formatBRL(r.min_price_cents / 100)}/h`}</span>
                {r.free_slots != null && <span className="mt-1 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900">{r.free_slots} horário(s) livre(s)</span>}</span>
            </Link></li>
          ))}
        </ul>
      </main>
    </div>
  )
}
