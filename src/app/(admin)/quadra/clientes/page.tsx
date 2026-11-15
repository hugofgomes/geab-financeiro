"use client"

import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SPORTS, sportLabel, useCourtRoleCtx } from "@/hooks/use-court-role"
import { useLoad } from "@/hooks/use-load"
import { KIND_LABEL, PAY_STATUS_LABEL, STATUS_LABEL, type Booking } from "@/lib/court-booking"
import { fmtDateBR, fmtRange, localParts } from "@/lib/court-time"
import { formatBRL } from "@/lib/format"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { maskPhone, normalizePhone } from "@/lib/whatsapp"
import { Download, Loader2, Plus } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Client = { id: string; name: string; phone: string | null; whatsapp: string | null; email: string | null; birth_date: string | null; favorite_sport: string | null; client_type: string; notes: string | null; status: string; birthday_consent: boolean; created_at: string }
const CLIENT_TYPES: [string, string][] = [["avulso", "Avulso"], ["mensalista", "Mensalista"], ["professor", "Professor"], ["organizador", "Organizador"], ["outros", "Outros"]]
const typeLabel = (v: string) => CLIENT_TYPES.find(([k]) => k === v)?.[1] ?? v
const phoneShow = (v: string | null) => (v ? maskPhone(v.replace(/^55/, "")) : "—")
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
const EMPTY = { name: "", phone: "", whatsapp: "", email: "", birth_date: "", favorite_sport: "", client_type: "avulso", notes: "", status: "ativo", birthday_consent: false }

async function load() {
  const sb = supabase()
  const [c, v] = await Promise.all([sb.from("court_clients").select("*").order("name").limit(5000), sb.from("court_venues").select("timezone").maybeSingle()])
  if (c.error) throw new Error(c.error.message)
  return { clients: (c.data ?? []) as Client[], tz: (v.data?.timezone as string | undefined) ?? "America/Sao_Paulo" }
}

function csvCell(v: string | null | undefined) { const s = v ?? ""; return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
/** Exporta para planilha (CSV com separador ";" e BOM: o Excel abre direto, com acentos). */
function exportCsv(rows: Client[]) {
  const head = ["Nome", "Telefone", "WhatsApp", "E-mail", "Nascimento", "Modalidade favorita", "Tipo", "Status", "Cadastro", "Observações"]
  const lines = rows.map((c) => [c.name, c.phone, c.whatsapp, c.email, c.birth_date ? fmtDateBR(c.birth_date) : "", c.favorite_sport ? sportLabel(c.favorite_sport) : "", typeLabel(c.client_type), c.status, fmtDateBR(c.created_at.slice(0, 10)), c.notes].map((x) => csvCell(x)).join(";"))
  const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" })
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href)
}

export default function ClientesPage() {
  const role = useCourtRoleCtx()!
  const canWrite = role !== "financeiro", canDelete = role === "admin" || role === "gerente"
  const { data, error, loading, reload } = useLoad(load, [])
  const [f, setF] = React.useState({ q: "", type: "", status: "ativo" })
  const [edit, setEdit] = React.useState<Client | "novo" | null>(null)
  const [hist, setHist] = React.useState<Client | null>(null)
  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading && !data) return <Skeleton className="h-72" />
  if (!data) return null
  const q = norm(f.q), qd = f.q.replace(/\D/g, "")
  const rows = data.clients.filter((c) => (!f.type || c.client_type === f.type) && (!f.status || c.status === f.status) && (!q || norm(c.name).includes(q) || norm(c.email ?? "").includes(q) || (qd.length >= 3 && (c.phone ?? "").includes(qd))))
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-xl font-semibold">Clientes</h1><p className="text-sm text-muted-foreground">Cadastro do seu estabelecimento. Visível só para a sua equipe.</p></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportCsv(rows)} disabled={!rows.length}><Download className="size-4" /> Exportar (Excel)</Button>
          {canWrite && <Button onClick={() => setEdit("novo")}><Plus className="size-4" /> Novo cliente</Button>}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input aria-label="Buscar cliente" placeholder="Buscar por nome, telefone ou e-mail" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <NativeSelect aria-label="Tipo" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Todos os tipos</option>{CLIENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
        <NativeSelect aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Ativos e inativos</option><option value="ativo">Ativos</option><option value="inativo">Inativos</option></NativeSelect>
      </div>
      <p className="text-sm text-muted-foreground">{rows.length} cliente(s)</p>

      <Card className="hidden overflow-x-auto py-0 md:block">
        <Table>
          <TableHeader><TableRow><TableHead className="pl-4">Nome</TableHead><TableHead>Telefone</TableHead><TableHead>E-mail</TableHead><TableHead>Tipo</TableHead><TableHead>Modalidade</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" tabIndex={0} onClick={() => setHist(c)} onKeyDown={(e) => e.key === "Enter" && setHist(c)}>
                <TableCell className="pl-4 font-medium">{c.name}</TableCell><TableCell className="whitespace-nowrap">{phoneShow(c.phone)}</TableCell><TableCell>{c.email ?? "—"}</TableCell>
                <TableCell>{typeLabel(c.client_type)}</TableCell><TableCell>{c.favorite_sport ? sportLabel(c.favorite_sport) : "—"}</TableCell>
                <TableCell><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", c.status === "ativo" ? "bg-green-100 text-green-900" : "bg-slate-200 text-slate-700")}>{c.status === "ativo" ? "Ativo" : "Inativo"}</span></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Nenhum cliente encontrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
      <ul className="space-y-2 md:hidden">
        {rows.map((c) => (
          <li key={c.id}><button type="button" onClick={() => setHist(c)} className="w-full rounded-xl border bg-card p-3 text-left">
            <span className="flex items-start justify-between gap-2"><span className="truncate font-semibold">{c.name}</span><span className="shrink-0 text-xs text-muted-foreground">{typeLabel(c.client_type)}{c.status === "inativo" && " · inativo"}</span></span>
            <span className="block text-sm text-muted-foreground">{phoneShow(c.phone)}{c.email && ` · ${c.email}`}</span>
          </button></li>
        ))}
        {rows.length === 0 && <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum cliente encontrado.</li>}
      </ul>

      <ClientForm key={edit === "novo" ? "novo" : edit?.id ?? "x"} open={!!edit} onClose={() => setEdit(null)} client={edit === "novo" ? null : edit} onSaved={() => { setEdit(null); reload() }} />
      <HistoryDialog client={hist} tz={data.tz} onClose={() => setHist(null)} canWrite={canWrite} canDelete={canDelete} onEdit={(c) => { setHist(null); setEdit(c) }} onChanged={() => { setHist(null); reload() }} />
    </>
  )
}

function ClientForm({ open, onClose, client, onSaved }: { open: boolean; onClose: () => void; client: Client | null; onSaved: () => void }) {
  const [v, setV] = React.useState(() => client ? { name: client.name, phone: phoneShow(client.phone) === "—" ? "" : phoneShow(client.phone), whatsapp: client.whatsapp ? phoneShow(client.whatsapp) : "", email: client.email ?? "", birth_date: client.birth_date ?? "", favorite_sport: client.favorite_sport ?? "", client_type: client.client_type, notes: client.notes ?? "", status: client.status, birthday_consent: client.birthday_consent } : EMPTY)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof EMPTY>(k: K, x: (typeof EMPTY)[K]) => setV((s) => ({ ...s, [k]: x }))
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const ph = v.phone ? normalizePhone(v.phone) : null, wa = v.whatsapp ? normalizePhone(v.whatsapp) : null
    if (v.phone && !ph) return toast.error("Telefone inválido: informe com DDD.")
    if (v.whatsapp && !wa) return toast.error("WhatsApp inválido: informe com DDD.")
    setBusy(true)
    const row = { name: v.name, phone: ph, whatsapp: wa, email: v.email || null, birth_date: v.birth_date || null, favorite_sport: v.favorite_sport || null, client_type: v.client_type, notes: v.notes || null, status: v.status, birthday_consent: v.birthday_consent && !!v.birth_date }
    const r = client ? await supabase().from("court_clients").update(row).eq("id", client.id) : await supabase().from("court_clients").insert(row)
    setBusy(false)
    if (r.error) return toast.error(/court_clients_phone_uniq|duplicate/.test(r.error.message) ? "Já existe um cliente com este telefone." : r.error.message)
    toast.success(client ? "Cliente atualizado." : "Cliente cadastrado."); onSaved()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{client ? "Editar cliente" : "Novo cliente"}</DialogTitle><DialogDescription>Use o telefone com DDD: é por ele que as reservas se ligam ao cliente.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="cn">Nome completo</Label><Input id="cn" required minLength={2} maxLength={120} value={v.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="cp">Telefone</Label><Input id="cp" inputMode="tel" value={v.phone} onChange={(e) => set("phone", maskPhone(e.target.value))} placeholder="(48) 99999-0000" /></div>
          <div className="space-y-1.5"><Label htmlFor="cw">WhatsApp</Label><Input id="cw" inputMode="tel" value={v.whatsapp} onChange={(e) => set("whatsapp", maskPhone(e.target.value))} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ce">E-mail</Label><Input id="ce" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="cb">Data de nascimento</Label><Input id="cb" type="date" max={new Date().toISOString().slice(0, 10)} value={v.birth_date} onChange={(e) => set("birth_date", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="cs">Modalidade favorita</Label><NativeSelect id="cs" value={v.favorite_sport} onChange={(e) => set("favorite_sport", e.target.value)}><option value="">—</option>{SPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="ct">Tipo de cliente</Label><NativeSelect id="ct" value={v.client_type} onChange={(e) => set("client_type", e.target.value)}>{CLIENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="cst">Status</Label><NativeSelect id="cst" value={v.status} onChange={(e) => set("status", e.target.value)}><option value="ativo">Ativo</option><option value="inativo">Inativo</option></NativeSelect></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="co">Observações</Label><Input id="co" maxLength={500} value={v.notes} onChange={(e) => set("notes", e.target.value)} /></div>
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={v.birthday_consent} disabled={!v.birth_date} onChange={(e) => set("birthday_consent", e.target.checked)} />
            <span>O cliente autorizou usar o aniversário (exibição no painel). Sem autorização, a data não aparece em avisos. (LGPD)</span></label>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Salvar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function HistoryDialog({ client, tz, onClose, canWrite, canDelete, onEdit, onChanged }: { client: Client | null; tz: string; onClose: () => void; canWrite: boolean; canDelete: boolean; onEdit: (c: Client) => void; onChanged: () => void }) {
  const { data, loading } = useLoad<Booking[]>(async () => {
    if (!client) return []
    const r = await supabase().from("court_bookings").select("*").eq("client_id", client.id).order("starts_at", { ascending: false }).limit(200)
    if (r.error) throw new Error(r.error.message)
    return r.data as Booking[]
  }, [client?.id])
  const [busy, setBusy] = React.useState(false)
  if (!client) return null
  const list = data ?? []
  const valid = list.filter((b) => b.status !== "cancelada")
  const total = valid.reduce((s, b) => s + b.price_cents, 0)
  async function toggle() {
    setBusy(true)
    const r = await supabase().from("court_clients").update({ status: client!.status === "ativo" ? "inativo" : "ativo" }).eq("id", client!.id)
    setBusy(false); if (r.error) toast.error(r.error.message); else { toast.success("Situação atualizada."); onChanged() }
  }
  async function remove() {
    if (!window.confirm(`Excluir ${client!.name}? Só é possível se o cliente não tiver reservas; caso contrário, desative.`)) return
    setBusy(true)
    const r = await supabase().from("court_clients").delete().eq("id", client!.id)
    setBusy(false)
    if (r.error) toast.error(/foreign key|violates/i.test(r.error.message) ? "Este cliente tem reservas: não pode ser excluído. Desative o cadastro." : r.error.message); else { toast.success("Cliente excluído."); onChanged() }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{client.name}</DialogTitle><DialogDescription>{typeLabel(client.client_type)} · {phoneShow(client.phone)}{client.email && ` · ${client.email}`}</DialogDescription></DialogHeader>
        {client.notes && <p className="rounded-lg bg-muted p-2 text-sm">{client.notes}</p>}
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-lg border p-2"><p className="text-lg font-semibold">{valid.length}</p><p className="text-xs text-muted-foreground">reservas</p></div>
          <div className="rounded-lg border p-2"><p className="text-lg font-semibold">{formatBRL(total / 100)}</p><p className="text-xs text-muted-foreground">em reservas</p></div>
          <div className="rounded-lg border p-2"><p className="text-lg font-semibold">{valid.filter((b) => b.payment_status !== "pago").length}</p><p className="text-xs text-muted-foreground">sem pagamento integral</p></div>
        </div>
        <h3 className="text-sm font-semibold">Histórico de reservas e pagamentos</h3>
        {loading ? <Skeleton className="h-24" /> : list.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma reserva ligada a este cliente (as reservas se ligam pelo telefone).</p> : (
          <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
            {list.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-1 rounded-lg border px-2 py-1.5">
                <span>{fmtDateBR(localParts(tz, b.starts_at).date)} · {fmtRange(tz, b.starts_at, b.ends_at)} <span className="text-xs text-muted-foreground">({b.code} · {KIND_LABEL[b.kind]})</span></span>
                <span className="text-xs">{STATUS_LABEL[b.status]} · {formatBRL(b.price_cents / 100)} · {PAY_STATUS_LABEL[b.payment_status]}</span>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter className="gap-2">
          {canDelete && <Button variant="outline" className="text-destructive" disabled={busy} onClick={remove}>Excluir</Button>}
          {canWrite && <Button variant="outline" disabled={busy} onClick={toggle}>{client.status === "ativo" ? "Desativar" : "Reativar"}</Button>}
          {canWrite && <Button onClick={() => onEdit(client)}>Editar</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
