"use client"

import { NativeSelect } from "@/components/native-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLoad } from "@/hooks/use-load"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight, Monitor, RefreshCw, Smartphone, Tablet } from "lucide-react"
import * as React from "react"

type Day = { day: string; users: number; orgs: number; hits: number }
type Row = { user_id: string; full_name: string | null; email: string | null; org_name: string | null; role: string | null; first_at: string; last_at: string; hits: number; user_agent: string | null }

const ROLE: Record<string, string> = { admin: "Administrador", diretoria: "Diretoria", atleta: "Atleta" }
const TZ = "America/Sao_Paulo"
const todayBR = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ })
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const longDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })
const shortDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })
const device = (ua: string | null) => !ua ? null : /iPad|Tablet/i.test(ua) ? "Tablet" : /iPhone|Android|Mobile/i.test(ua) ? "Celular" : "Computador"
const DevIcon = ({ d }: { d: string | null }) => d === "Celular" ? <Smartphone className="size-4" aria-label="Celular" /> : d === "Tablet" ? <Tablet className="size-4" aria-label="Tablet" /> : d ? <Monitor className="size-4" aria-label="Computador" /> : <span>—</span>
const period = (a: string, b: string) => (hora(a) === hora(b) ? hora(a) : `${hora(a)} – ${hora(b)}`)

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3.5 shadow-sm sm:p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-primary sm:text-2xl">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Log de acessos diários da plataforma: restrito ao administrador geral (o banco recusa qualquer outro). */
export default function AccessLogPage() {
  const [days, setDays] = React.useState(30)
  const [sel, setSel] = React.useState<string | null>(null)
  const [q, setQ] = React.useState("")
  const resumo = useLoad(async () => {
    const r = await supabase().rpc("sa_access_daily", { p_days: days })
    if (r.error) throw new Error(r.error.message)
    return (r.data ?? []) as Day[]
  }, [days])

  const today = todayBR()
  // Linha do tempo completa do período (dias sem acesso aparecem zerados no gráfico).
  const series = React.useMemo(() => {
    const map = new Map((resumo.data ?? []).map((d) => [d.day, d]))
    return Array.from({ length: days }, (_, i) => { const day = addDays(today, i - days + 1); return map.get(day) ?? { day, users: 0, orgs: 0, hits: 0 } })
  }, [resumo.data, days, today])
  const day = sel ?? today
  const maxUsers = Math.max(1, ...series.map((s) => s.users))
  const todayRow = series[series.length - 1]
  const total = series.reduce((a, s) => a + s.users, 0)
  const peak = series.reduce((a, s) => (s.users > a.users ? s : a), series[0])

  const detalhe = useLoad(async () => {
    const r = await supabase().rpc("sa_access_day", { p_day: day })
    if (r.error) throw new Error(r.error.message)
    return (r.data ?? []) as Row[]
  }, [day])
  const reload = () => { resumo.reload(); detalhe.reload() }
  // Atualiza sozinho a cada minuto, só com a aba visível.
  const reloadRef = React.useRef(reload)
  reloadRef.current = reload
  React.useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && reloadRef.current(), 60_000)
    return () => clearInterval(t)
  }, [])

  const rows = (detalhe.data ?? []).filter((r) => `${r.full_name ?? ""} ${r.email ?? ""} ${r.org_name ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
  const loading = resumo.loading && !resumo.data

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Log de acessos</h1>
          <p className="text-sm text-muted-foreground">Quem abriu o sistema em cada dia (horário de Brasília). Visível só para o administrador geral.</p>
        </div>
        <div className="flex items-center gap-2">
          <NativeSelect aria-label="Período" value={days} onChange={(e) => { setDays(Number(e.target.value)); setSel(null) }}>
            <option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option>
          </NativeSelect>
          <Button variant="outline" size="icon" onClick={reload} aria-label="Atualizar"><RefreshCw className={cn((resumo.loading || detalhe.loading) && "animate-spin")} /></Button>
        </div>
      </div>
      {(resumo.error || detalhe.error) && <p role="alert" className="text-sm text-destructive">Erro ao carregar: {resumo.error ?? detalhe.error}</p>}

      {loading ? <Skeleton className="h-64" /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Pessoas hoje" value={todayRow.users} />
            <Stat label="Grupos hoje" value={todayRow.orgs} />
            <Stat label="Aberturas hoje" value={todayRow.hits} />
            <Stat label="Média por dia" value={(total / days).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} hint={peak.users ? `Pico: ${peak.users} em ${shortDay(peak.day)}` : "Sem acessos no período"} />
          </div>

          <section aria-label="Pessoas por dia" className="rounded-xl border bg-card p-3.5 shadow-sm sm:p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">Pessoas por dia</h2>
              <span className="text-[11px] text-muted-foreground">Toque numa barra para ver o dia</span>
            </div>
            <div className="flex h-28 items-end gap-[3px] sm:h-32" role="group" aria-label="Dias do período">
              {series.map((s) => (
                <button key={s.day} type="button" onClick={() => setSel(s.day)} aria-pressed={s.day === day}
                  aria-label={`${shortDay(s.day)}: ${s.users} ${s.users === 1 ? "pessoa" : "pessoas"}`} title={`${shortDay(s.day)} · ${s.users} ${s.users === 1 ? "pessoa" : "pessoas"}`}
                  className="group flex h-full min-w-0 flex-1 flex-col justify-end outline-none">
                  <span className={cn("block w-full rounded-t transition-colors", s.day === day ? "bg-[#EF3028]" : s.users ? "bg-[#1E3A5F] group-hover:bg-[#2A5A8C]" : "bg-[#E2E8F0]")}
                    style={{ height: s.users ? `${Math.max(8, (s.users / maxUsers) * 100)}%` : "4px" }} />
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground"><span>{shortDay(series[0].day)}</span><span>{shortDay(today)}</span></div>
          </section>

          <section aria-label="Detalhe do dia" className="rounded-xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3 sm:px-4">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => setSel(addDays(day, -1))} aria-label="Dia anterior"><ChevronLeft /></Button>
                <div className="min-w-0 text-center sm:min-w-44">
                  <p className="text-sm font-semibold capitalize">{longDay(day)}</p>
                  <p className="text-[11px] text-muted-foreground">{day === today ? "Hoje · " : ""}{detalhe.data ? `${detalhe.data.length} ${detalhe.data.length === 1 ? "pessoa" : "pessoas"}` : "…"}</p>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setSel(addDays(day, 1))} disabled={day >= today} aria-label="Próximo dia"><ChevronRight /></Button>
              </div>
              <Input className="h-8 w-full sm:w-60" placeholder="Buscar pessoa, e-mail ou grupo" aria-label="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>

            {detalhe.loading && !detalhe.data ? <Skeleton className="m-3 h-32" /> : rows.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">{detalhe.data?.length ? "Ninguém encontrado nessa busca." : "Sem acessos neste dia."}</p>
            ) : (
              <>
                <ul className="divide-y md:hidden">
                  {rows.map((r) => (
                    <li key={r.user_id} className="space-y-1 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{r.full_name ?? "—"}</p><p className="truncate text-xs text-muted-foreground">{r.email}</p></div>
                        <Badge variant="secondary" className="shrink-0">{ROLE[r.role ?? ""] ?? "—"}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="text-foreground">{r.org_name ?? "—"}</span>
                        <span className="tabular-nums">{period(r.first_at, r.last_at)}</span>
                        <span>{r.hits} {r.hits === 1 ? "abertura" : "aberturas"}</span>
                        <DevIcon d={device(r.user_agent)} />
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden md:block">
                  <Table>
                    <TableHeader><TableRow><TableHead>Pessoa</TableHead><TableHead>Grupo</TableHead><TableHead>Perfil</TableHead><TableHead>Horário</TableHead><TableHead className="text-right">Aberturas</TableHead><TableHead className="w-10"><span className="sr-only">Aparelho</span></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.user_id}>
                          <TableCell className="max-w-[16rem]"><div className="truncate font-medium">{r.full_name ?? "—"}</div><div className="truncate text-xs text-muted-foreground">{r.email}</div></TableCell>
                          <TableCell className="text-sm">{r.org_name ?? "—"}</TableCell>
                          <TableCell><Badge variant="secondary">{ROLE[r.role ?? ""] ?? "—"}</Badge></TableCell>
                          <TableCell className="text-sm tabular-nums whitespace-nowrap">{period(r.first_at, r.last_at)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.hits}</TableCell>
                          <TableCell className="text-muted-foreground"><DevIcon d={device(r.user_agent)} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </>
  )
}
