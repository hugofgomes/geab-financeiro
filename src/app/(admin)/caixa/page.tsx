"use client"

import { SetupNotice } from "@/components/setup-notice"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/native-select"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLoad } from "@/hooks/use-load"
import { formatBRL, formatDate } from "@/lib/format"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Expense } from "@/lib/types"

interface Income { id: string; received_at: string; description: string; category: string | null; amount: number }
import { Loader2, Pencil, Trash2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

/** Edição de uma despesa (também serve para preencher o local das despesas antigas). */
function EditExpense({ x, places, onClose, onSaved }: { x: Expense | null; places: string[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = React.useState({ date: "", desc: "", cat: "", loc: "", amount: "" })
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (x) setD({ date: x.spent_at, desc: x.description, cat: x.category ?? "", loc: x.location ?? "", amount: String(x.amount).replace(".", ",") })
  }, [x])
  if (!x) return null
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const v = Number(d.amount.replace(",", "."))
    if (!d.desc.trim()) return toast.error("Descreva a despesa.")
    if (!Number.isFinite(v) || v <= 0) return toast.error("Informe um valor maior que zero.")
    setBusy(true)
    const { error } = await supabase().from("expenses").update({ spent_at: d.date, description: d.desc.trim(), category: d.cat.trim() || null, location: d.loc.trim() || null, amount: v }).eq("id", x!.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Despesa atualizada.")
    onSaved(); onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Editar despesa</DialogTitle></DialogHeader>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="ed">Data</Label><Input id="ed" type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} required /></div>
          <div className="space-y-1.5"><Label htmlFor="ev">Valor (R$)</Label><Input id="ev" inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} required /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="es">Descrição</Label><Input id="es" value={d.desc} onChange={(e) => setD({ ...d, desc: e.target.value })} required /></div>
          <div className="space-y-1.5"><Label htmlFor="ec">Categoria</Label><Input id="ec" value={d.cat} onChange={(e) => setD({ ...d, cat: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="el">Local</Label><Input id="el" list="geab-locais" maxLength={80} value={d.loc} onChange={(e) => setD({ ...d, loc: e.target.value })} placeholder="Ex.: Quadra Trindade" />
            <datalist id="geab-locais">{places.map((p) => <option key={p} value={p} />)}</datalist></div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

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
  const [loc, setLoc] = React.useState("")
  const [editing, setEditing] = React.useState<Expense | null>(null)
  const [filterLoc, setFilterLoc] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  if (!supabaseConfigured) return <SetupNotice />
  const places = [...new Set((data?.expenses ?? []).map((x) => x.location).filter((l): l is string => !!l))].sort((a, b) => a.localeCompare(b, "pt-BR"))
  const shown = (data?.expenses ?? []).filter((x) => !filterLoc || (filterLoc === "__sem" ? !x.location : x.location === filterLoc))
  const shownTotal = shown.reduce((t, x) => t + Number(x.amount), 0)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const v = Number(amount.replace(",", "."))
    if (!desc.trim()) return toast.error("Descreva a despesa.")
    if (!Number.isFinite(v) || v <= 0) return toast.error("Informe um valor maior que zero.")
    setBusy(true)
    const { error } = await supabase().from("expenses").insert({ spent_at: date, description: desc.trim(), category: cat.trim() || null, location: loc.trim() || null, amount: v })
    setBusy(false)
    if (error) return toast.error(error.message)
    setDesc(""); setCat(""); setLoc(""); setAmount("")
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
          <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Despesas</div><div className="text-2xl font-semibold tabular-nums text-[#B4151B]">{formatBRL(data.totalOut)}</div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">Saldo em caixa</div><div className="text-2xl font-semibold tabular-nums">{formatBRL(data.totalIn - data.totalOut)}</div></CardContent></Card>
        </div>
      )}
      <form data-write onSubmit={add} className="grid grid-cols-2 gap-x-3 gap-y-4 rounded-xl border bg-card p-4 md:grid-cols-12">
        <h2 className="col-span-full text-base font-semibold">Registrar despesa</h2>
        <div className="flex flex-col gap-1.5 md:col-span-3"><Label htmlFor="xd">Data</Label><Input id="xd" type="date" className="h-9" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        <div className="col-span-2 flex flex-col gap-1.5 md:col-span-9"><Label htmlFor="xs">Descrição</Label><Input id="xs" className="h-9" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ex.: Aluguel da quadra" required /></div>
        <div className="flex flex-col gap-1.5 md:col-span-4"><Label htmlFor="xc">Categoria</Label><Input id="xc" className="h-9" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Quadra, Goleiro…" /></div>
        <div className="flex flex-col gap-1.5 md:col-span-4"><Label htmlFor="xl">Local</Label><Input id="xl" className="h-9" list="geab-locais-novo" maxLength={80} value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Ex.: Quadra Trindade" /></div>
        <div className="flex flex-col gap-1.5 md:col-span-2"><Label htmlFor="xv">Valor (R$)</Label><Input id="xv" className="h-9" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required /></div>
        <div className="col-span-2 flex flex-col gap-1.5 md:col-span-2"><span aria-hidden className="hidden h-3.5 md:block" /><Button type="submit" className="h-9 w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Adicionar</Button></div>
        <datalist id="geab-locais-novo">{places.map((p) => <option key={p} value={p} />)}</datalist>
      </form>
      {data && data.expenses.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">Local
            <NativeSelect value={filterLoc} onChange={(e) => setFilterLoc(e.target.value)} aria-label="Filtrar por local">
              <option value="">Todos</option>
              {places.map((p) => <option key={p} value={p}>{p}</option>)}
              <option value="__sem">Sem local informado</option>
            </NativeSelect>
          </label>
          {filterLoc && <span className="text-muted-foreground">{shown.length} despesa(s) · total <strong className="text-foreground tabular-nums">{formatBRL(shownTotal)}</strong></span>}
        </div>
      )}
      {loading && !data ? <Skeleton className="h-40" /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead>Categoria</TableHead><TableHead>Local</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
            <TableBody>
              {shown.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{data?.expenses.length ? "Nenhuma despesa neste local." : "Nenhuma despesa registrada."}</TableCell></TableRow>}
              {shown.map((x) => (
                <TableRow key={x.id}><TableCell>{formatDate(x.spent_at)}</TableCell><TableCell>{x.description}</TableCell><TableCell>{x.category ?? "—"}</TableCell><TableCell>{x.location ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{formatBRL(x.amount)}</TableCell>
                  <TableCell><div data-write className="flex justify-end gap-0.5"><Button variant="ghost" size="icon-sm" onClick={() => setEditing(x)} aria-label={`Editar ${x.description}`}><Pencil /></Button><Button variant="ghost" size="icon-sm" onClick={() => remove(x)} aria-label={`Excluir ${x.description}`}><Trash2 /></Button></div></TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <EditExpense x={editing} places={places} onClose={() => setEditing(null)} onSaved={reload} />
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
