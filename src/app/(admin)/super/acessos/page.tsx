"use client"

import { NativeSelect } from "@/components/native-select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLoad } from "@/hooks/use-load"
import { supabase } from "@/lib/supabase/client"
import * as React from "react"

type Day = { day: string; users: number; orgs: number; hits: number }
type Row = { user_id: string; full_name: string | null; email: string | null; org_name: string | null; role: string | null; first_at: string; last_at: string; hits: number; user_agent: string | null }

const ROLE: Record<string, string> = { admin: "Administrador", diretoria: "Diretoria", atleta: "Atleta" }
const dia = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
const aparelho = (ua: string | null) => !ua ? "—" : /iPhone|Android|Mobile/i.test(ua) ? "Celular" : /iPad|Tablet/i.test(ua) ? "Tablet" : "Computador"

/** Log de acessos diários da plataforma: restrito ao administrador geral (o banco recusa qualquer outro). */
export default function AccessLogPage() {
  const [days, setDays] = React.useState(30)
  const [sel, setSel] = React.useState<string | null>(null)
  const resumo = useLoad(async () => {
    const r = await supabase().rpc("sa_access_daily", { p_days: days })
    if (r.error) throw new Error(r.error.message)
    return (r.data ?? []) as Day[]
  }, [days])
  const day = sel ?? resumo.data?.[0]?.day ?? null
  const detalhe = useLoad(async () => {
    if (!day) return [] as Row[]
    const r = await supabase().rpc("sa_access_day", { p_day: day })
    if (r.error) throw new Error(r.error.message)
    return (r.data ?? []) as Row[]
  }, [day])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Log de acessos</h1>
          <p className="text-sm text-muted-foreground">Quem abriu o sistema em cada dia (horário de Brasília). Visível só para o administrador geral.</p>
        </div>
        <NativeSelect aria-label="Período" value={days} onChange={(e) => { setDays(Number(e.target.value)); setSel(null) }}>
          <option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option>
        </NativeSelect>
      </div>
      {(resumo.error || detalhe.error) && <p role="alert" className="text-sm text-destructive">Erro ao carregar: {resumo.error ?? detalhe.error}</p>}
      {resumo.loading && !resumo.data ? <Skeleton className="h-48" /> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Dia</TableHead><TableHead className="text-right">Pessoas</TableHead><TableHead className="text-right">Grupos</TableHead></TableRow></TableHeader>
              <TableBody>
                {(resumo.data ?? []).length === 0 && <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">Nenhum acesso registrado no período. Os acessos passam a ser contados após a atualização do sistema.</TableCell></TableRow>}
                {(resumo.data ?? []).map((d) => (
                  <TableRow key={d.day} data-state={d.day === day ? "selected" : undefined} className="cursor-pointer" onClick={() => setSel(d.day)}>
                    <TableCell><button type="button" className="font-medium capitalize outline-none focus-visible:underline" aria-pressed={d.day === day}>{dia(d.day)}</button></TableCell>
                    <TableCell className="text-right tabular-nums">{d.users}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.orgs}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <p className="border-b px-4 py-2.5 text-sm font-medium capitalize">{day ? dia(day) : "—"}</p>
            {detalhe.loading ? <Skeleton className="m-3 h-32" /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Pessoa</TableHead><TableHead>Grupo</TableHead><TableHead>Perfil</TableHead><TableHead>1º acesso</TableHead><TableHead>Último</TableHead><TableHead className="text-right">Aberturas</TableHead><TableHead>Aparelho</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(detalhe.data ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Sem acessos neste dia.</TableCell></TableRow>}
                  {(detalhe.data ?? []).map((r) => (
                    <TableRow key={r.user_id}>
                      <TableCell><div className="font-medium">{r.full_name ?? "—"}</div><div className="text-xs text-muted-foreground">{r.email}</div></TableCell>
                      <TableCell className="text-sm">{r.org_name ?? "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{ROLE[r.role ?? ""] ?? "—"}</Badge></TableCell>
                      <TableCell className="tabular-nums">{hora(r.first_at)}</TableCell>
                      <TableCell className="tabular-nums">{hora(r.last_at)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.hits}</TableCell>
                      <TableCell className="text-sm">{aparelho(r.user_agent)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </>
  )
}
