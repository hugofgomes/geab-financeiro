"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useLoad } from "@/hooks/use-load"
import { sportLabel, useCourtRoleCtx } from "@/hooks/use-court-role"
import { supabase } from "@/lib/supabase/client"
import { formatBRL } from "@/lib/format"
import { CheckCircle2, Circle } from "lucide-react"
import Link from "next/link"

type Venue = { trade_name: string; document: string | null; phone: string | null; whatsapp: string | null; email: string | null; city: string | null; state: string | null; street: string | null; logo_url: string | null; description: string | null } | null
type Court = { id: string; name: string; sport: string; active: boolean; price_cents: number; photos: string[] }

async function load() {
  const sb = supabase()
  const [v, c] = await Promise.all([sb.from("court_venues").select("trade_name, document, phone, whatsapp, email, city, state, street, logo_url, description").maybeSingle(), sb.from("court_courts").select("id, name, sport, active, price_cents, photos").order("sort_order").order("name")])
  if (v.error) throw new Error(v.error.message)
  if (c.error) throw new Error(c.error.message)
  return { venue: v.data as Venue, courts: (c.data ?? []) as Court[] }
}

/** Dashboard da Fase 1: panorama do cadastro do centro e das quadras. Os indicadores de reservas e financeiro chegam com as próximas fases. */
export default function QuadraDashboard() {
  const role = useCourtRoleCtx()
  const { data, error, loading } = useLoad(load, [])
  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading && !data) return <Skeleton className="h-60" />
  if (!data) return null
  const { venue, courts } = data
  const active = courts.filter((c) => c.active)
  const sports = [...new Set(active.map((c) => c.sport))]
  const steps = [
    { ok: !!venue, label: "Cadastrar o centro esportivo", hint: "Nome, documento e contatos", href: "/quadra/centro" },
    { ok: !!(venue?.street && venue.city && venue.state), label: "Informar o endereço", hint: "Para a página pública e para os jogadores encontrarem", href: "/quadra/centro" },
    { ok: courts.length > 0, label: "Cadastrar a primeira quadra", hint: "Modalidade, piso, capacidade e valor por horário", href: "/quadra/centro" },
    { ok: courts.some((c) => c.photos.length > 0), label: "Adicionar fotos das quadras", hint: "Aparecem na página pública", href: "/quadra/centro" },
    { ok: !!venue?.logo_url, label: "Enviar o logotipo", hint: "Identidade do seu centro esportivo", href: "/quadra/centro" },
  ]
  const done = steps.filter((s) => s.ok).length
  const kpi = (label: string, value: string, hint?: string) => (
    <div className="rounded-xl border bg-card p-4"><div className="text-3xl font-bold tabular-nums text-primary">{value}</div><div className="text-sm text-muted-foreground">{label}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div>
  )
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{venue?.trade_name ?? "Quadra Esportiva"}</h1>
        <p className="text-sm text-muted-foreground">Visão geral do seu centro esportivo{venue?.city ? ` · ${venue.city}${venue.state ? `/${venue.state}` : ""}` : ""}.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpi("Quadras cadastradas", String(courts.length))}
        {kpi("Quadras ativas", String(active.length), courts.length - active.length ? `${courts.length - active.length} inativa(s)` : undefined)}
        {kpi("Modalidades", String(sports.length), sports.slice(0, 3).map(sportLabel).join(", ") || undefined)}
        {kpi("Cadastro do centro", `${done}/${steps.length}`, done === steps.length ? "Completo" : "Em andamento")}
      </div>

      <Card><CardContent className="space-y-3 pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Primeiros passos</h2>
        <ul className="divide-y">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-3 py-3">
              {s.ok ? <CheckCircle2 className="size-5 shrink-0 text-green-600" aria-label="Concluído" /> : <Circle className="size-5 shrink-0 text-muted-foreground" aria-label="Pendente" />}
              <div className="min-w-0 flex-1"><p className={s.ok ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>{s.label}</p><p className="text-xs text-muted-foreground">{s.hint}</p></div>
              {!s.ok && role !== "recepcionista" && role !== "financeiro" && <Link href={s.href} className="inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 text-sm font-medium text-primary hover:bg-secondary">Fazer agora</Link>}
            </li>
          ))}
        </ul>
      </CardContent></Card>

      {courts.length > 0 && (
        <Card><CardContent className="space-y-3 pt-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Suas quadras</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {courts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                <span className="min-w-0"><span className="block truncate font-medium">{c.name}</span><span className="block text-xs text-muted-foreground">{sportLabel(c.sport)} · {formatBRL(c.price_cents / 100)}/horário</span></span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${c.active ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-700"}`}>{c.active ? "Ativa" : "Inativa"}</span>
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}

      <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Agenda, reservas, financeiro e relatórios chegam nas próximas etapas do módulo. Os indicadores de ocupação e faturamento aparecem aqui assim que houver reservas.</p>
    </>
  )
}
