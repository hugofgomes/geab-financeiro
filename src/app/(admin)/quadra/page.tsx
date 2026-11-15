"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useCourtRoleCtx } from "@/hooks/use-court-role"
import { useLoad } from "@/hooks/use-load"
import { KIND_LABEL } from "@/lib/court-booking"
import { fmtHours, fmtPct, pct } from "@/lib/court-report"
import { addDays, fmtDateBR, fmtRange, localParts, MONTHS, todayIn } from "@/lib/court-time"
import { formatBRL } from "@/lib/format"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { CheckCircle2, Circle } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

type Dash = {
  courts_total: number; courts_active: number; bookings_today: number; bookings_week: number; bookings_month: number; free_minutes_today: number; free_by_court_today: { court: string; free_min: number }[]
  occupancy: { open_min: number; booked_min: number }; daily: { day: string; open_min: number; booked_min: number }[]; by_kind: { kind: string; n: number }[]; peak_hours: { hour: number; n: number }[]
  done_vs_cancelled: { done: number; cancelled: number }; months: { month: string; bookings: number; received: number | null }[]
  upcoming: { code: string; client_name: string; court: string; starts_at: string; ends_at: string; status: string }[]; pending: { code: string; client_name: string; court: string; starts_at: string; ends_at: string }[]; pending_total: number
  clients_active: number; monthly_clients_active: number; waitlist: number | null; birthdays: { name: string; day: number }[] | null
  revenue_month: number | null; to_receive: number | null; overdue: number | null; no_hours: boolean
} | null

// Cores do Partidou para gráficos; categorias seguem a agenda (laranja, verde, roxo, cinza).
const C = { lime: "#B9F344", forest: "#142C25", graphite: "#19221D", kind: { avulsa: "#fb923c", mensalista: "#22c55e", mensalista_professor: "#a855f7", bloqueio: "#94a3b8" } as Record<string, string> }

async function load(from: string, to: string) {
  const sb = supabase()
  const [v, c, d] = await Promise.all([
    sb.from("court_venues").select("trade_name, document, street, city, state, logo_url, timezone").maybeSingle(),
    sb.from("court_courts").select("id, name, sport, active, photos").order("sort_order").order("name"),
    sb.rpc("court_dashboard", { p_from: from, p_to: to }),
  ])
  if (v.error) throw new Error(v.error.message)
  if (c.error) throw new Error(c.error.message)
  if (d.error) throw new Error(d.error.message)
  return { venue: v.data as { trade_name: string; document: string | null; street: string | null; city: string | null; state: string | null; logo_url: string | null; timezone: string } | null, courts: (c.data ?? []) as { id: string; name: string; sport: string; active: boolean; photos: string[] }[], dash: d.data as Dash }
}

/** Dashboard do centro: indicadores e gráficos calculados no servidor com os dados reais (e o período escolhido). */
export default function QuadraDashboard() {
  const role = useCourtRoleCtx()
  const t0 = React.useMemo(() => todayIn("America/Sao_Paulo"), [])
  const [period, setPeriod] = React.useState({ from: addDays(t0, -29), to: t0 })
  const { data, error, loading } = useLoad(() => load(period.from, period.to), [period.from, period.to])
  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading && !data) return <Skeleton className="h-60" />
  if (!data) return null
  const { venue, courts, dash } = data
  const tz = venue?.timezone ?? "America/Sao_Paulo"
  const active = courts.filter((c) => c.active)
  const steps = [
    { ok: !!venue, label: "Cadastrar o centro esportivo", hint: "Nome, documento e contatos", href: "/quadra/centro" },
    { ok: !!(venue?.street && venue.city && venue.state), label: "Informar o endereço", hint: "Para a página pública e para os jogadores encontrarem", href: "/quadra/centro" },
    { ok: courts.length > 0, label: "Cadastrar a primeira quadra", hint: "Modalidade, piso, capacidade e valor por horário", href: "/quadra/centro" },
    { ok: !!dash && !dash.no_hours, label: "Configurar horários de funcionamento", hint: "Sem isso a agenda não aceita reservas", href: "/quadra/configuracoes" },
    { ok: !!venue?.logo_url, label: "Enviar o logotipo", hint: "Identidade do seu centro esportivo", href: "/quadra/centro" },
  ]
  const pending = steps.filter((s) => !s.ok)
  const canSetup = role === "admin" || role === "gerente"
  const kpi = (label: string, value: string, hint?: string, tone?: "bad" | "good") => (
    <div className="rounded-xl border bg-card p-4"><div className={cn("text-2xl font-bold tabular-nums text-primary sm:text-3xl", tone === "bad" && "text-red-700")}>{value}</div><div className="text-sm text-muted-foreground">{label}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div>
  )
  const rate = dash ? pct(dash.occupancy.booked_min, dash.occupancy.open_min) : 0
  const daily = (dash?.daily ?? []).map((d) => ({ dia: d.day.slice(8) + "/" + d.day.slice(5, 7), taxa: pct(d.booked_min, d.open_min) }))
  const kinds = (dash?.by_kind ?? []).map((k) => ({ name: KIND_LABEL[k.kind as keyof typeof KIND_LABEL] ?? k.kind, value: k.n, key: k.kind }))
  const months = (dash?.months ?? []).map((m) => ({ mes: MONTHS[Number(m.month.slice(5, 7)) - 1].slice(0, 3), reservas: m.bookings, receita: m.received == null ? undefined : m.received / 100 }))
  const peak = (dash?.peak_hours ?? []).map((h) => ({ hora: `${String(h.hour).padStart(2, "0")}h`, reservas: h.n }))
  const dvc = dash ? [{ name: "Realizadas", n: dash.done_vs_cancelled.done }, { name: "Canceladas", n: dash.done_vs_cancelled.cancelled }] : []
  const ttip = { contentStyle: { borderRadius: 8, border: "1px solid #d9e0d4", fontSize: 12 } }
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{venue?.trade_name ?? "Quadra Esportiva"}</h1>
          <p className="text-sm text-muted-foreground">Visão geral do seu centro esportivo{venue?.city ? ` · ${venue.city}${venue.state ? `/${venue.state}` : ""}` : ""}.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label htmlFor="df">De</Label><Input id="df" type="date" value={period.from} max={period.to} onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="dt">Até</Label><Input id="dt" type="date" value={period.to} min={period.from} onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })} /></div>
        </div>
      </div>

      {pending.length > 0 && (
        <Card><CardContent className="space-y-2 pt-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Primeiros passos · {steps.length - pending.length}/{steps.length}</h2>
          <ul className="divide-y">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3 py-2">
                {s.ok ? <CheckCircle2 className="size-5 shrink-0 text-green-600" aria-label="Concluído" /> : <Circle className="size-5 shrink-0 text-muted-foreground" aria-label="Pendente" />}
                <div className="min-w-0 flex-1"><p className={s.ok ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>{s.label}</p><p className="text-xs text-muted-foreground">{s.hint}</p></div>
                {!s.ok && canSetup && <Link href={s.href} className="inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 text-sm font-medium text-primary hover:bg-secondary">Fazer agora</Link>}
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}

      {!dash ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Cadastre o centro esportivo para ver os indicadores.</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpi("Quadras cadastradas", String(dash.courts_total), `${active.length} ativa(s)`)}
            {kpi("Reservas hoje", String(dash.bookings_today))}
            {kpi("Reservas da semana", String(dash.bookings_week))}
            {kpi("Reservas do mês", String(dash.bookings_month))}
            {kpi("Horários livres hoje", fmtHours(dash.free_minutes_today), "somando todas as quadras")}
            {kpi("Taxa de ocupação", fmtPct(rate), `${new Date(period.from + "T12:00").toLocaleDateString("pt-BR")} a ${new Date(period.to + "T12:00").toLocaleDateString("pt-BR")}`)}
            {kpi("Clientes ativos", String(dash.clients_active))}
            {kpi("Mensalistas ativos", String(dash.monthly_clients_active))}
            {dash.revenue_month != null && kpi("Faturamento do mês", formatBRL(dash.revenue_month / 100), "pagamentos recebidos")}
            {dash.to_receive != null && kpi("Valores a receber", formatBRL(dash.to_receive / 100))}
            {dash.overdue != null && kpi("Valores em atraso", formatBRL(dash.overdue / 100), undefined, dash.overdue > 0 ? "bad" : undefined)}
            {dash.waitlist != null && kpi("Na lista de espera", String(dash.waitlist))}
          </div>

          {dash.no_hours && <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Os horários de funcionamento não foram configurados: a ocupação e os horários livres ficam zerados até você configurá-los em Configurações.</p>}
          {dash.pending_total > 0 && <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{dash.pending_total} reserva(s) pendente(s) de confirmação. <Link href="/quadra/reservas" className="font-medium underline">Ver reservas</Link></p>}

          <div className="grid gap-3 lg:grid-cols-2">
            <Card><CardContent className="space-y-2 pt-4"><h2 className="text-sm font-semibold">Ocupação por dia (%)</h2>
              <div className="h-56" role="img" aria-label="Gráfico de ocupação por dia"><ResponsiveContainer width="100%" height="100%"><LineChart data={daily}><CartesianGrid strokeDasharray="3 3" stroke="#e5e9e2" /><XAxis dataKey="dia" fontSize={11} interval="preserveStartEnd" /><YAxis fontSize={11} unit="%" domain={[0, 100]} /><Tooltip {...ttip} formatter={(v) => [`${v}%`, "Ocupação"]} /><Line type="monotone" dataKey="taxa" stroke={C.forest} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div></CardContent></Card>
            <Card><CardContent className="space-y-2 pt-4"><h2 className="text-sm font-semibold">Horários de maior movimento</h2>
              <div className="h-56" role="img" aria-label="Gráfico de reservas por horário"><ResponsiveContainer width="100%" height="100%"><BarChart data={peak}><CartesianGrid strokeDasharray="3 3" stroke="#e5e9e2" /><XAxis dataKey="hora" fontSize={11} /><YAxis fontSize={11} allowDecimals={false} /><Tooltip {...ttip} /><Bar dataKey="reservas" fill={C.forest} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></CardContent></Card>
            <Card><CardContent className="space-y-2 pt-4"><h2 className="text-sm font-semibold">Reservas e receita nos últimos 6 meses</h2>
              <div className="h-56" role="img" aria-label="Comparativo mensal"><ResponsiveContainer width="100%" height="100%"><BarChart data={months}><CartesianGrid strokeDasharray="3 3" stroke="#e5e9e2" /><XAxis dataKey="mes" fontSize={11} /><YAxis yAxisId="l" fontSize={11} allowDecimals={false} />{dash.revenue_month != null && <YAxis yAxisId="r" orientation="right" fontSize={11} />}<Tooltip {...ttip} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar yAxisId="l" dataKey="reservas" fill={C.forest} radius={[4, 4, 0, 0]} />{dash.revenue_month != null && <Bar yAxisId="r" dataKey="receita" name="Receita (R$)" fill={C.lime} radius={[4, 4, 0, 0]} />}</BarChart></ResponsiveContainer></div></CardContent></Card>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card><CardContent className="space-y-2 pt-4"><h2 className="text-sm font-semibold">Reservas por categoria</h2>
                {kinds.length === 0 ? <p className="text-xs text-muted-foreground">Sem reservas no período.</p> : <div className="h-44" role="img" aria-label="Reservas por categoria"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={kinds} dataKey="value" nameKey="name" innerRadius={30} outerRadius={60}>{kinds.map((k) => <Cell key={k.key} fill={C.kind[k.key]} />)}</Pie><Tooltip {...ttip} /></PieChart></ResponsiveContainer></div>}
                <ul className="space-y-0.5 text-xs">{kinds.map((k) => <li key={k.key} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: C.kind[k.key] }} />{k.name}: {k.value}</li>)}</ul></CardContent></Card>
              <Card><CardContent className="space-y-2 pt-4"><h2 className="text-sm font-semibold">Realizadas × canceladas</h2>
                <div className="h-44" role="img" aria-label="Realizadas versus canceladas"><ResponsiveContainer width="100%" height="100%"><BarChart data={dvc}><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} allowDecimals={false} /><Tooltip {...ttip} /><Bar dataKey="n" name="Reservas" radius={[4, 4, 0, 0]}><Cell fill={C.forest} /><Cell fill="#94a3b8" /></Bar></BarChart></ResponsiveContainer></div></CardContent></Card>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card><CardContent className="space-y-2 pt-4"><h2 className="text-sm font-semibold">Próximas reservas</h2>
              {dash.upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma reserva futura.</p> : <ul className="divide-y text-sm">{dash.upcoming.map((b) => <li key={b.code} className="flex flex-wrap items-center justify-between gap-1 py-2"><span className="min-w-0"><span className="block truncate font-medium">{b.client_name}</span><span className="block text-xs text-muted-foreground">{b.court} · {b.code}</span></span><span className="text-right text-xs">{fmtDateBR(localParts(tz, b.starts_at).date)}<br />{fmtRange(tz, b.starts_at, b.ends_at)}</span></li>)}</ul>}</CardContent></Card>
            <Card><CardContent className="space-y-2 pt-4"><h2 className="text-sm font-semibold">Pendentes de confirmação</h2>
              {dash.pending.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma pendência.</p> : <ul className="divide-y text-sm">{dash.pending.map((b) => <li key={b.code} className="flex flex-wrap items-center justify-between gap-1 py-2"><span className="min-w-0"><span className="block truncate font-medium">{b.client_name}</span><span className="block text-xs text-muted-foreground">{b.court} · {b.code}</span></span><span className="text-right text-xs">{fmtDateBR(localParts(tz, b.starts_at).date)}<br />{fmtRange(tz, b.starts_at, b.ends_at)}</span></li>)}</ul>}</CardContent></Card>
            <Card><CardContent className="space-y-2 pt-4"><h2 className="text-sm font-semibold">Horários vagos hoje (podem ser divulgados)</h2>
              {dash.free_by_court_today.every((x) => x.free_min === 0) ? <p className="text-sm text-muted-foreground">Sem horários livres hoje.</p> : <ul className="divide-y text-sm">{dash.free_by_court_today.filter((x) => x.free_min > 0).map((x) => <li key={x.court} className="flex justify-between gap-2 py-2"><span>{x.court}</span><span className="tabular-nums">{fmtHours(x.free_min)} livres</span></li>)}</ul>}
              <Link href="/quadra/agenda" className="text-sm font-medium text-primary underline">Abrir a agenda</Link></CardContent></Card>
            {dash.birthdays != null && <Card><CardContent className="space-y-2 pt-4"><h2 className="text-sm font-semibold">Aniversariantes de {MONTHS[Number(todayIn(tz).slice(5, 7)) - 1].toLowerCase()}</h2>
              {dash.birthdays.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum aniversariante com autorização cadastrada.</p> : <ul className="divide-y text-sm">{dash.birthdays.map((b) => <li key={b.name + b.day} className="flex justify-between gap-2 py-2"><span>{b.name}</span><span className="tabular-nums">dia {b.day}</span></li>)}</ul>}
              <p className="text-xs text-muted-foreground">Só aparecem clientes que autorizaram o uso do aniversário.</p></CardContent></Card>}
          </div>
        </>
      )}
    </>
  )
}
