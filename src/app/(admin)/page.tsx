"use client"

import { SetupNotice } from "@/components/setup-notice"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useLoad } from "@/hooks/use-load"
import { addMonths, formatBRL, formatCompetence, formatDate, monthKey } from "@/lib/format"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Charge, Payment } from "@/lib/types"
import { AlertTriangle, CalendarClock, CircleDollarSign, Hourglass, Landmark, Users, type LucideIcon } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

async function loadDashboard() {
  const sb = supabase()
  const since = addMonths(monthKey(), -11)
  const [ath, ch, pay, cash] = await Promise.all([
    sb.from("athletes").select("id, full_name, nickname, active"),
    sb.from("charges_view").select("*").gte("competence", since),
    sb.from("payments").select("*").gte("paid_at", since).order("paid_at", { ascending: false }),
    sb.from("cash_summary").select("total_in, total_out").single(),
  ])
  for (const r of [ath, ch, pay, cash]) if (r.error) throw new Error(r.error.message)
  return {
    athletes: ath.data as { id: string; full_name: string; nickname: string | null; active: boolean }[],
    charges: ch.data as Charge[],
    payments: pay.data as Payment[],
    totalIn: Number(cash.data!.total_in),
    totalOut: Number(cash.data!.total_out),
  }
}

function Kpi({ label, value, hint, tone, icon: Icon }: { label: string; value: string; hint?: string; tone?: "bad" | "good"; icon: LucideIcon }) {
  return (
    <Card className="hover:shadow-md">
      <CardContent className="flex items-start justify-between gap-3 pt-4">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-[#B4151B]" : tone === "good" ? "text-green-700" : "text-primary"}`}>{value}</div>
          {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
        </div>
        <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone === "bad" ? "bg-[#F32329]/10 text-[#F32329]" : "bg-secondary text-primary"}`}><Icon className="size-5" /></span>
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const { data, error, loading } = useLoad(loadDashboard, [])
  if (!supabaseConfigured) return <SetupNotice />
  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading || !data) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>

  const name = new Map(data.athletes.map((a) => [a.id, a.nickname || a.full_name]))
  const month = monthKey()
  const cur = data.charges.filter((c) => c.competence === month)
  const planned = cur.reduce((a, c) => a + c.amount, 0)
  const paidCur = cur.reduce((a, c) => a + c.paid_total, 0)
  const pending = cur.reduce((a, c) => a + c.balance, 0)
  const receivedMonth = data.payments.filter((p) => p.paid_at.startsWith(month.slice(0, 7))).reduce((a, p) => a + p.amount, 0)
  const late = data.charges.filter((c) => c.display_status === "atrasado")
  const lateByAthlete = new Map<string, { total: number; count: number }>()
  for (const c of late) {
    const e = lateByAthlete.get(c.athlete_id) ?? { total: 0, count: 0 }
    lateByAthlete.set(c.athlete_id, { total: e.total + c.balance, count: e.count + 1 })
  }
  const months = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11))
  const chart = months.map((m) => ({
    mes: formatCompetence(m).slice(0, 3) + "/" + m.slice(2, 4),
    Previsto: data.charges.filter((c) => c.competence === m).reduce((a, c) => a + c.amount, 0),
    Recebido: data.payments.filter((p) => p.paid_at.startsWith(m.slice(0, 7))).reduce((a, p) => a + p.amount, 0),
  }))

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Visão geral <span className="text-base font-normal text-muted-foreground">· {formatCompetence(month)}</span></h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi icon={Users} label="Atletas ativos" value={String(data.athletes.filter((a) => a.active).length)} />
        <Kpi icon={CalendarClock} label="Previsto no mês" value={formatBRL(planned)} hint={cur.length ? `${cur.length} mensalidades` : "Nenhuma mensalidade gerada neste mês"} />
        <Kpi icon={CircleDollarSign} label="Recebido no mês" value={formatBRL(receivedMonth)} hint={planned ? `${Math.round((paidCur / planned) * 100)}% do previsto` : undefined} tone="good" />
        <Kpi icon={Hourglass} label="Pendente no mês" value={formatBRL(pending)} />
        <Kpi icon={AlertTriangle} label="Atletas inadimplentes" value={String(lateByAthlete.size)} hint={late.length ? `${late.length} mensalidade(s) em atraso` : "Ninguém em atraso"} tone={lateByAthlete.size ? "bad" : undefined} />
        <Kpi icon={Landmark} label="Saldo em caixa" value={formatBRL(data.totalIn - data.totalOut)} hint="Pagamentos − despesas (total)" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Arrecadação mensal · últimos 12 meses</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => formatBRL(Number(v)).replace(",00", "")} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
              <Tooltip formatter={(v) => formatBRL(Number(v))} cursor={{ fill: "rgb(28 61 99 / 0.06)" }} contentStyle={{ borderRadius: 12, border: "1px solid #DCE3EC", boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)" }} />
              <Legend iconType="circle" />
              <Bar dataKey="Previsto" fill="#B6C3D4" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="Recebido" fill="#1C3D63" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Pagamentos recentes</CardTitle></CardHeader>
          <CardContent>
            {data.payments.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p> : (
              <ul className="divide-y text-sm">
                {data.payments.slice(0, 8).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <span>{name.get(p.athlete_id) ?? "—"} <span className="text-xs text-muted-foreground">· {formatDate(p.paid_at)}</span></span>
                    <span className="font-medium tabular-nums">{formatBRL(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Inadimplentes</CardTitle></CardHeader>
          <CardContent>
            {lateByAthlete.size === 0 ? <p className="text-sm text-muted-foreground">Nenhum atleta em atraso.</p> : (
              <ul className="divide-y text-sm">
                {[...lateByAthlete].sort((a, b) => b[1].total - a[1].total).map(([id, v]) => (
                  <li key={id} className="flex items-center justify-between gap-2 py-2">
                    <span className="flex items-center gap-2">{name.get(id) ?? "—"} <StatusBadge status="atrasado" /></span>
                    <span className="tabular-nums">{formatBRL(v.total)} <span className="text-xs text-muted-foreground">({v.count}x)</span></span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
