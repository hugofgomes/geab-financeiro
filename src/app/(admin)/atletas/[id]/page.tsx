"use client"

import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLoad } from "@/hooks/use-load"
import { formatBRL, formatCompetence, formatDate } from "@/lib/format"
import { supabase } from "@/lib/supabase/client"
import type { Athlete, Charge, Payment } from "@/lib/types"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"

export default function AthleteHistory() {
  const { id } = useParams<{ id: string }>()
  const { data, error, loading } = useLoad(async () => {
    const sb = supabase()
    const [a, c, p] = await Promise.all([
      sb.from("athletes").select("*").eq("id", id).single(),
      sb.from("charges_view").select("*").eq("athlete_id", id).order("competence", { ascending: false }),
      sb.from("payments").select("*").eq("athlete_id", id).order("paid_at", { ascending: false }),
    ])
    for (const r of [a, c, p]) if (r.error) throw new Error(r.error.message)
    return { athlete: a.data as Athlete, charges: c.data as Charge[], payments: p.data as Payment[] }
  }, [id])

  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading || !data) return <Skeleton className="h-64" />
  const { athlete, charges, payments } = data
  const owed = charges.reduce((a, c) => a + (c.display_status === "atrasado" ? c.balance : 0), 0)

  return (
    <>
      <Link href="/atletas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Atletas</Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{athlete.full_name}</h1>
        <p className="text-sm text-muted-foreground">{formatBRL(athlete.monthly_fee)}/mês · vence dia {athlete.due_day} · {athlete.active ? "ativo" : "inativo"}{owed > 0 && <span className="font-medium text-red-700"> · em atraso: {formatBRL(owed)}</span>}</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Mensalidades</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Competência</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Pago</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
            <TableBody>
              {charges.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Sem mensalidades geradas.</TableCell></TableRow>}
              {charges.map((c) => (
                <TableRow key={c.id}><TableCell className="capitalize">{formatCompetence(c.competence)}</TableCell><TableCell>{formatDate(c.due_date)}</TableCell><TableCell className="text-right tabular-nums">{formatBRL(c.amount)}</TableCell><TableCell className="text-right tabular-nums">{formatBRL(c.paid_total)}</TableCell><TableCell><StatusBadge status={c.display_status} /></TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Pagamentos</CardTitle></CardHeader>
        <CardContent>
          {payments.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p> : (
            <ul className="divide-y text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex justify-between py-2"><span>{formatDate(p.paid_at)} <span className="text-xs text-muted-foreground">· {p.method}{p.notes ? ` · ${p.notes}` : ""}</span></span><span className="font-medium tabular-nums">{formatBRL(p.amount)}</span></li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}
