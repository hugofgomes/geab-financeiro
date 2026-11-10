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
    <Card className="gap-0 rounded-xl py-0 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_12px_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_10px_rgb(15_23_42/0.06),0_10px_24px_rgb(15_23_42/0.07)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <CardContent className="flex items-start justify-between gap-3 p-3.5 sm:p-5">
        <div className="min-w-0">
          <div className="text-[13px] leading-tight font-medium text-muted-foreground">{label}</div>
          <div className={`mt-2 text-xl leading-none font-bold tracking-tight tabular-nums sm:text-[26px] ${tone === "bad" ? "text-[#B4151B]" : tone === "good" ? "text-[#059669]" : "text-primary"}`}>{value}</div>
          {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
        </div>
        <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-lg sm:size-10 sm:rounded-xl ${tone === "bad" ? "bg-[#EF3028]/10 text-[#EF3028]" : tone === "good" ? "bg-[#059669]/10 text-[#059669]" : "bg-secondary text-primary"}`}><Icon className="size-4 sm:size-5" /></span>
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const { data, error, loading } = useLoad(loadDashboard, [])
  if (!supabaseConfigured) return <SetupNotice />
  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading || !data) return <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>

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
      <h1 className="text-2xl font-bold tracking-tight">Visão geral <span className="text-base font-normal text-muted-foreground">· {formatCompetence(month)}</span></h1>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        <Kpi icon={Users} label="Atletas ativos" value={String(data.athletes.filter((a) => a.active).length)} />
        <Kpi icon={CalendarClock} label="Previsto no mês" value={formatBRL(planned)} hint={cur.length ? `${cur.length} mensalidades` : "Nenhuma mensalidade gerada neste mês"} />
        <Kpi icon={CircleDollarSign} label="Recebido no mês" value={formatBRL(receivedMonth)} hint={planned ? `${Math.round((paidCur / planned) * 100)}% do previsto` : undefined} tone="good" />
        <Kpi icon={Hourglass} label="Pendente no mês" value={formatBRL(pending)} />
        <Kpi icon={AlertTriangle} label="Atletas inadimplentes" value={String(lateByAthlete.size)} hint={late.length ? `${late.length} mensalidade(s) em atraso` : "Ninguém em atraso"} tone={lateByAthlete.size ? "bad" : undefined} />
        <Kpi icon={Landmark} label="Saldo em caixa" value={formatBRL(data.totalIn - data.totalOut)} hint="Pagamentos − despesas (total)" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Arrecadação mensal · últimos 12 meses</CardTitle></CardHeader>
        <CardContent className="h-72">
          {!chart.some((c) => c.Previsto || c.Recebido) ? (
            <div className="grid h-full place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground"><p>Ainda não há mensalidades nem pagamentos nos últimos 12 meses.<br />Os valores aparecem aqui assim que forem lançados.</p></div>
          ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ left: 4, right: 8, top: 4 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="#EEF2F6" strokeDasharray="3 3" />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#5C6B80" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => formatBRL(Number(v)).replace(",00", "")} tick={{ fontSize: 12, fill: "#5C6B80" }} axisLine={false} tickLine={false} width={76} />
              <Tooltip formatter={(v) => formatBRL(Number(v))} cursor={{ fill: "rgb(30 58 95 / 0.05)" }}
                contentStyle={{ borderRadius: 12, border: "1px solid #E2E8F0", boxShadow: "0 8px 24px rgb(15 23 42 / 0.10)", fontSize: 12, padding: "8px 12px" }} labelStyle={{ fontWeight: 600, color: "#1F2937", marginBottom: 4 }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Bar dataKey="Previsto" fill="#C3D1E3" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="Recebido" fill="#1E3A5F" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Pagamentos recentes</CardTitle></CardHeader>
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
          <CardHeader><CardTitle className="text-sm font-medium">Inadimplentes</CardTitle></CardHeader>
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
