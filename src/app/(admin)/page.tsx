"use client"

import { BRAND_PRIMARY } from "@/lib/brand"

import { SetupNotice } from "@/components/setup-notice"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useLoad } from "@/hooks/use-load"
import { addMonths, formatBRL, formatCompetence, formatDate, monthKey } from "@/lib/format"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Charge, Payment } from "@/lib/types"
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

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" | "good" }) {
  return (
    <div className="px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1.5 text-xl leading-none font-semibold tracking-tight tabular-nums sm:text-2xl ${tone === "bad" ? "text-[#B4151B]" : tone === "good" ? "text-[#047857]" : "text-foreground"}`}>{value}</div>
      {hint && <div className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

export default function Dashboard() {
  const { data, error, loading } = useLoad(loadDashboard, [])
  if (!supabaseConfigured) return <SetupNotice />
  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading || !data) return <Skeleton className="h-24 rounded-xl" />

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
      <h1 className="text-xl font-semibold tracking-tight">Visão geral <span className="text-sm font-normal text-muted-foreground">· {formatCompetence(month)}</span></h1>
      <div className="grid grid-cols-2 divide-x divide-y rounded-xl bg-card ring-1 ring-border xl:grid-cols-4 xl:divide-y-0 [&>*:nth-child(-n+2)]:border-t-0 max-xl:[&>*:nth-child(odd)]:border-l-0">
        <Kpi label="Atletas ativos" value={String(data.athletes.filter((a) => a.active).length)} />
        <Kpi label="Recebido no mês" value={formatBRL(receivedMonth)} hint={planned ? `${Math.round((paidCur / planned) * 100)}% de ${formatBRL(planned)} previstos` : "Nenhuma mensalidade gerada"} tone="good" />
        <Kpi label="Pendente no mês" value={formatBRL(pending)} hint={lateByAthlete.size ? `${lateByAthlete.size} inadimplente(s) · ${late.length} em atraso` : "Ninguém em atraso"} tone={lateByAthlete.size ? "bad" : undefined} />
        <Kpi label="Saldo em caixa" value={formatBRL(data.totalIn - data.totalOut)} hint="Pagamentos − despesas" />
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
                contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", boxShadow: "0 4px 12px rgb(15 23 42 / 0.06)", fontSize: 12, padding: "8px 12px" }} labelStyle={{ fontWeight: 600, color: "#1F2937", marginBottom: 4 }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Bar dataKey="Previsto" fill="#C3D1E3" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="Recebido" fill={BRAND_PRIMARY} radius={[4, 4, 0, 0]} isAnimationActive={false} />
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
