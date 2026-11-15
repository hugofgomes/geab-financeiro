"use client"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtDateBR, fmtRange, localParts } from "@/lib/court-time"
import { supabase } from "@/lib/supabase/client"
import { maskPhone } from "@/lib/whatsapp"
import { cn } from "@/lib/utils"
import { MessageCircle } from "lucide-react"
import { useParams } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

type M = { id: string; title: string; description: string | null; status: "aberta" | "completa" | "cancelada"; slots_total: number
  booking: { code: string; status: string; starts_at: string; ends_at: string; court: string; venue: string; timezone: string; whatsapp: string | null; slug: string }
  players: { id: string; name: string; phone: string; status: "pendente" | "aprovado" | "recusado" | "removido" }[] }
const ST: Record<string, string> = { pendente: "Pendente", aprovado: "Aprovado", recusado: "Recusado", removido: "Removido" }

/** Gestão da partida pelo organizador, com o código secreto do link (sem login). */
export default function GerirPartida() {
  const { token } = useParams<{ token: string }>()
  const [m, setM] = React.useState<M | null | undefined>(undefined)
  const [busy, setBusy] = React.useState("")
  const load = React.useCallback(async () => { const r = await supabase().rpc("court_match_manage_get", { p_token: token }); setM((r.data ?? null) as M | null) }, [token])
  React.useEffect(() => { void load() }, [load])
  async function decide(id: string, d: "aprovado" | "recusado" | "removido") {
    setBusy(id)
    const r = await supabase().rpc("court_match_manage_decide", { p_token: token, p_player: id, p_decision: d })
    setBusy(""); if (r.error) toast.error(r.error.message); else void load()
  }
  async function cancel() {
    if (!window.confirm("Cancelar a publicação desta partida? Os pedidos deixam de valer (a reserva do horário continua com o centro).")) return
    const r = await supabase().rpc("court_match_manage_cancel", { p_token: token }); if (r.error) toast.error(r.error.message); else void load()
  }
  if (m === undefined) return <div className="quadra-theme min-h-dvh bg-background p-6"><Skeleton className="mx-auto h-60 max-w-xl" /></div>
  if (m === null) return <div className="quadra-theme grid min-h-dvh place-items-center bg-background p-6 text-center"><div><h1 className="text-xl font-bold">Link inválido</h1><p className="mt-1 text-sm text-muted-foreground">Confira se copiou o link completo da sua partida.</p></div></div>
  const b = m.booking, tz = b.timezone
  const approved = m.players.filter((p) => p.status === "aprovado")
  const wa = (p: M["players"][number]) => `https://wa.me/${p.phone}?text=${encodeURIComponent(`Oi, ${p.name.split(" ")[0]}! Sobre a partida "${m.title}" (${fmtDateBR(localParts(tz, b.starts_at).date)} ${fmtRange(tz, b.starts_at, b.ends_at)}, ${b.venue}).`)}`
  const share = `${m.title} · ${b.venue}, ${b.court}, ${fmtDateBR(localParts(tz, b.starts_at).date)} ${fmtRange(tz, b.starts_at, b.ends_at)}. Faltam ${m.slots_total - approved.length} jogador(es)! Peça sua vaga: ${typeof window === "undefined" ? "" : window.location.origin}/quadras/${b.slug}`
  return (
    <div className="quadra-theme min-h-dvh bg-background text-foreground">
      <header className="bg-primary px-4 py-5 text-primary-foreground"><div className="mx-auto max-w-xl"><p className="text-xs font-semibold tracking-wide opacity-80">PARTIDOU · SUA PARTIDA</p><h1 className="text-2xl font-bold">{m.title}</h1><p className="text-sm opacity-90">{b.venue} · {b.court} · {fmtDateBR(localParts(tz, b.starts_at).date)} {fmtRange(tz, b.starts_at, b.ends_at)}</p></div></header>
      <main className="mx-auto max-w-xl space-y-4 px-4 py-6">
        <div className="rounded-xl border bg-card p-3 text-sm"><p>Reserva <strong>{b.code}</strong>: {b.status === "confirmada" ? "confirmada pelo centro" : b.status === "pendente" ? "aguardando confirmação do centro (a partida só aparece na vitrine depois de confirmada)" : b.status === "cancelada" ? "cancelada" : b.status}.</p>
          <p className="mt-1">Vagas: <strong>{approved.length}/{m.slots_total}</strong> preenchidas · partida <strong>{m.status}</strong>.</p></div>
        {m.status !== "cancelada" && <div className="flex flex-wrap gap-2"><a className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(share)}`}><MessageCircle className="size-4" /> Convidar pelo WhatsApp</a><Button variant="outline" onClick={cancel}>Cancelar publicação</Button></div>}
        <h2 className="text-lg font-semibold">Pedidos de vaga</h2>
        <ul className="space-y-2">
          {m.players.map((p) => (
            <li key={p.id} className="rounded-xl border bg-card p-3"><div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0"><p className="font-medium">{p.name} <span className={cn("ml-1 rounded-full px-2 py-0.5 text-xs", p.status === "aprovado" ? "bg-green-100 text-green-900" : p.status === "pendente" ? "bg-amber-100 text-amber-900" : "bg-slate-200 text-slate-700")}>{ST[p.status]}</span></p><p className="text-sm text-muted-foreground">{maskPhone(p.phone.replace(/^55/, ""))}</p></div>
              <div className="flex flex-wrap gap-1">
                <a className="inline-flex h-8 items-center rounded-lg border px-2 text-sm" target="_blank" rel="noreferrer" href={wa(p)}>WhatsApp</a>
                {m.status !== "cancelada" && p.status !== "aprovado" && <Button size="sm" disabled={busy === p.id} onClick={() => decide(p.id, "aprovado")}>Aprovar</Button>}
                {m.status !== "cancelada" && p.status === "pendente" && <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => decide(p.id, "recusado")}>Recusar</Button>}
                {m.status !== "cancelada" && p.status === "aprovado" && <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => decide(p.id, "removido")}>Remover</Button>}
              </div></div></li>
          ))}
          {m.players.length === 0 && <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Ainda não há pedidos. Compartilhe a partida para receber jogadores.</li>}
        </ul>
        <p className="text-xs text-muted-foreground">Quem tem este link controla a partida: não o compartilhe publicamente.</p>
      </main>
    </div>
  )
}
