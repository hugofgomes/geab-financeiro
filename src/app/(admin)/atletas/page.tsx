"use client"

import { AthleteDialog } from "@/components/athlete-form"
import { NativeSelect } from "@/components/native-select"
import { SetupNotice } from "@/components/setup-notice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLoad } from "@/hooks/use-load"
import { formatBRL } from "@/lib/format"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Athlete } from "@/lib/types"
import { Pencil, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { toast } from "sonner"

export default function AthletesPage() {
  const { data, error, loading, reload } = useLoad(async () => {
    const r = await supabase().from("athletes").select("*").order("full_name")
    if (r.error) throw new Error(r.error.message)
    return r.data as Athlete[]
  }, [])
  const [q, setQ] = React.useState("")
  const [filter, setFilter] = React.useState<"ativos" | "inativos" | "todos">("ativos")
  const [editing, setEditing] = React.useState<Athlete | null>(null)
  const [open, setOpen] = React.useState(false)

  if (!supabaseConfigured) return <SetupNotice />

  const rows = (data ?? []).filter((a) =>
    (filter === "todos" || (filter === "ativos") === a.active) &&
    `${a.full_name} ${a.nickname ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))

  const nAtivos = (data ?? []).filter((a) => a.active).length
  const nInativos = (data ?? []).length - nAtivos

  async function toggle(a: Athlete) {
    const { error } = await supabase().from("athletes").update({ active: !a.active }).eq("id", a.id)
    if (error) return toast.error(error.message)
    toast.success(a.active ? "Atleta desativado." : "Atleta ativado.")
    reload()
  }

  async function remove(a: Athlete) {
    const ok = window.confirm(
      `Excluir definitivamente "${a.full_name}"?\n\nSerão apagados o cadastro, as mensalidades em aberto, as mensagens registradas e o acesso ao portal. Esta ação não pode ser desfeita.\n\nSe o atleta já tem pagamentos, a exclusão é bloqueada (use "Ativo" para desativar).`,
    )
    if (!ok) return
    const { error } = await supabase().rpc("admin_delete_athlete", { p_athlete: a.id })
    if (error) return toast.error(error.message, { duration: 8000 })
    toast.success(`${a.full_name} excluído.`)
    reload()
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Atletas</h1>
          {data && <p className="text-sm text-muted-foreground">{data.length} cadastrado{data.length === 1 ? "" : "s"} · {nAtivos} ativo{nAtivos === 1 ? "" : "s"} · {nInativos} inativo{nInativos === 1 ? "" : "s"}</p>}
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true) }}><Plus /> Novo atleta</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Buscar por nome ou apelido" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar atleta" />
        <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Situação">
          <option value="ativos">Ativos ({nAtivos})</option><option value="inativos">Inativos ({nInativos})</option><option value="todos">Todos ({(data ?? []).length})</option>
        </NativeSelect>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>}
      {loading && !data ? <Skeleton className="h-48" /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Atleta</TableHead><TableHead>Telefone</TableHead><TableHead className="text-right">Mensalidade</TableHead><TableHead>Venc.</TableHead><TableHead>Ativo</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{data?.length ? "Nenhum atleta encontrado." : "Nenhum atleta cadastrado ainda."}</TableCell></TableRow>}
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link href={`/atletas/${a.id}`} className="font-medium hover:underline">{a.full_name}</Link>
                    {a.nickname && <span className="ml-1 text-xs text-muted-foreground">({a.nickname})</span>}
                  </TableCell>
                  <TableCell className="text-sm">{a.phone ? `+${a.phone}` : "—"} {a.whatsapp_consent && <Badge variant="outline" className="ml-1 text-[10px]">WhatsApp ok</Badge>}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(a.monthly_fee)}</TableCell>
                  <TableCell>dia {a.due_day}</TableCell>
                  <TableCell><Switch checked={a.active} onCheckedChange={() => toggle(a)} aria-label={`Ativo: ${a.full_name}`} /></TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon-sm" onClick={() => { setEditing(a); setOpen(true) }} aria-label={`Editar ${a.full_name}`}><Pencil /></Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => remove(a)} aria-label={`Excluir ${a.full_name}`} className="text-destructive hover:text-destructive"><Trash2 /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <AthleteDialog open={open} athlete={editing} onClose={() => setOpen(false)} onSaved={reload} />
    </>
  )
}
