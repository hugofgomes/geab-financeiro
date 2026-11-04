"use client"

import { SetupNotice } from "@/components/setup-notice"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLoad } from "@/hooks/use-load"
import { formatBRL, formatDate } from "@/lib/format"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Expense } from "@/lib/types"

interface Income { id: string; received_at: string; description: string; category: string | null; amount: number }
import { Loader2, Trash2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

export default function CashPage() {
  const { data, error, loading, reload } = useLoad(async () => {
    const sb = supabase()
    const [e, c, inc] = await Promise.all([
      sb.from("expenses").select("*").order("spent_at", { ascending: false }).limit(200),
      sb.from("cash_summary").select("total_in, total_out").single(),
      sb.from("other_income").select("*").order("received_at", { ascending: false }).limit(200),
    ])
    for (const r of [e, c]) if (r.error) throw new Error(r.error.message)
    // other_income só existe depois da migração 0002; sem ela o caixa continua funcionando.
    return { expenses: e.data as Expense[], income: (inc.error ? [] : inc.data) as Income[], hasIncome: !inc.error, totalIn: Number(c.data!.total_in), totalOut: Number(c.data!.total_out) }
  }, [])
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [desc, setDesc] = React.useState("")
  const [cat, setCat] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  if (!supabaseConfigured) return <SetupNotice />

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const v = Number(amount.replace(",", "."))
    if (!desc.trim()) return toast.error("Descreva a despesa.")
    if (!Number.isFinite(v) || v <= 0) return toast.error("Informe um valor maior que zero.")
    setBusy(true)
    const { error } = await supabase().from("expenses").insert({ spent_at: date, description: desc.trim(), category: cat.trim() || null, amount: v })
    setBusy(false)
    if (error) return toast.error(error.message)
    setDesc(""); setCat(""); setAmount("")
    toast.success("Despesa registrada.")
    reload()
  }
  async function remove(x: Expense) {
    if (!window.confirm(`Excluir a despesa “${x.description}” (${formatBRL(x.amount)})?`)) return
    const { error } = await supabase().from("expenses").delete().eq("id", x.id)
    if (error) return toast.error(error.message)
    toast.success("Despesa excluída.")
    reload()
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Caixa</h1>
      {error && <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>}
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Entradas (mensalidades e outras)</div><div className="text-2xl font-semibold tabular-nums text-green-700">{formatBRL(data.totalIn)}</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Despesas</div><div className="text-2xl font-semibold tabular-nums text-red-700">{formatBRL(data.totalOut)}</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Saldo em caixa</div><div className="text-2xl font-semibold tabular-nums">{formatBRL(data.totalIn - data.totalOut)}</div></CardContent></Card>
        </div>
      )}
      <form onSubmit={add} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[9rem_1fr_10rem_8rem_auto] sm:items-end">
        <div className="space-y-1.5"><Label htmlFor="xd">Data</Label><Input id="xd" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        <div className="space-y-1.5"><Label htmlFor="xs">Descrição</Label><Input id="xs" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ex.: Aluguel da quadra" required /></div>
        <div className="space-y-1.5"><Label htmlFor="xc">Categoria</Label><Input id="xc" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Quadra, Goleiro…" /></div>
        <div className="space-y-1.5"><Label htmlFor="xv">Valor (R$)</Label><Input id="xv" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
        <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Adicionar</Button>
      </form>
      {loading && !data ? <Skeleton className="h-40" /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead>Categoria</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
            <TableBody>
              {data?.expenses.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nenhuma despesa registrada.</TableCell></TableRow>}
              {data?.expenses.map((x) => (
                <TableRow key={x.id}><TableCell>{formatDate(x.spent_at)}</TableCell><TableCell>{x.description}</TableCell><TableCell>{x.category ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{formatBRL(x.amount)}</TableCell>
                  <TableCell><Button variant="ghost" size="icon-sm" onClick={() => remove(x)} aria-label={`Excluir ${x.description}`}><Trash2 /></Button></TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data?.hasIncome && data.income.length > 0 && (
        <>
          <h2 className="text-lg font-semibold">Outras entradas</h2>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead>Categoria</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.income.map((x) => (
                  <TableRow key={x.id}><TableCell>{formatDate(x.received_at)}</TableCell><TableCell className="max-w-md">{x.description}</TableCell><TableCell>{x.category ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{formatBRL(x.amount)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  )
}
