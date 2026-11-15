"use client"

import { NativeSelect } from "@/components/native-select"
import { BookingFormDialog, DetailDialog, type Ctx } from "@/components/quadra/booking-dialogs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SPORTS, sportLabel, useCourtRoleCtx } from "@/hooks/use-court-role"
import { useCourtData } from "@/hooks/use-court-data"
import { KIND_LABEL, KIND_STYLE, PAY_STATUS_LABEL, STATUS_LABEL, bookingTitle, type Booking } from "@/lib/court-booking"
import { addDays, fmtDateBR, fmtRange, localParts, todayIn, zonedToUtc } from "@/lib/court-time"
import { formatBRL } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Plus } from "lucide-react"
import * as React from "react"

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

export default function ReservasPage() {
  const role = useCourtRoleCtx()!
  const [period, setPeriod] = React.useState<{ from: string; to: string } | null>(null)
  const [f, setF] = React.useState({ q: "", court: "", sport: "", kind: "", status: "", pay: "" })
  const [detail, setDetail] = React.useState<Booking | null>(null)
  const [edit, setEdit] = React.useState<Booking | null>(null)
  const [create, setCreate] = React.useState(false)
  const range = React.useCallback((tz: string) => {
    const t = todayIn(tz), p = period ?? { from: addDays(t, -7), to: addDays(t, 30) }
    return { from: zonedToUtc(tz, p.from, 0).toISOString(), to: zonedToUtc(tz, addDays(p.to, 1), 0).toISOString() }
  }, [period])
  const { data, error, loading, reload } = useCourtData(range, [period?.from, period?.to], true)
  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading && !data) return <Skeleton className="h-72" />
  if (!data) return null
  const { venue, courts } = data
  if (!venue) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Cadastre o centro esportivo para ver as reservas.</p>
  const tz = venue.timezone, t = todayIn(tz), p = period ?? { from: addDays(t, -7), to: addDays(t, 30) }
  const ctx: Ctx = { venue, courts, role, reload }
  const byId = new Map(courts.map((c) => [c.id, c]))
  const canBook = role === "admin" || role === "gerente" || role === "recepcionista"
  const rows = data.bookings.filter((b) => (!f.court || b.court_id === f.court) && (!f.sport || b.sport === f.sport) && (!f.kind || b.kind === f.kind) && (!f.status || b.status === f.status) && (!f.pay || b.payment_status === f.pay)
    && (!f.q || norm(`${b.code} ${b.client_name ?? ""} ${b.client_phone ?? ""}`).includes(norm(f.q)))).sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  const sel = "h-10 w-full sm:h-9 sm:w-auto"
  const stCls = (s: string) => s === "confirmada" ? "bg-green-100 text-green-800" : s === "pendente" ? "bg-amber-100 text-amber-900" : s === "concluida" ? "bg-blue-100 text-blue-800" : s === "cancelada" ? "bg-slate-200 text-slate-700" : "bg-red-100 text-red-800"

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold tracking-tight">Reservas</h1><p className="text-sm text-muted-foreground">Todas as reservas e bloqueios do período. Toque numa linha para ver, confirmar, remarcar ou cancelar.</p></div>
        {canBook && <Button className="h-11 w-full sm:h-9 sm:w-auto" onClick={() => setCreate(true)}><Plus /> Nova reserva</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Buscar por cliente, telefone ou código" placeholder="Buscar cliente, telefone ou código…" className="h-10 w-full sm:h-9 sm:w-64" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <label className="flex items-center gap-1.5 text-sm">De <Input type="date" aria-label="De" className="h-10 w-auto sm:h-9" value={p.from} onChange={(e) => e.target.value && setPeriod({ from: e.target.value, to: p.to < e.target.value ? e.target.value : p.to })} /></label>
        <label className="flex items-center gap-1.5 text-sm">até <Input type="date" aria-label="Até" className="h-10 w-auto sm:h-9" value={p.to} onChange={(e) => e.target.value && setPeriod({ from: p.from > e.target.value ? e.target.value : p.from, to: e.target.value })} /></label>
        <NativeSelect aria-label="Quadra" className={sel} value={f.court} onChange={(e) => setF({ ...f, court: e.target.value })}><option value="">Todas as quadras</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        <NativeSelect aria-label="Modalidade" className={sel} value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })}><option value="">Todas as modalidades</option>{SPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
        <NativeSelect aria-label="Categoria" className={sel} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">Todas as categorias</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
        <NativeSelect aria-label="Status" className={sel} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Todos os status</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
        <NativeSelect aria-label="Situação financeira" className={sel} value={f.pay} onChange={(e) => setF({ ...f, pay: e.target.value })}><option value="">Toda situação financeira</option>{Object.entries(PAY_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
      </div>
      <p className="text-sm text-muted-foreground">{rows.length} registro(s)</p>

      <Card className="hidden overflow-x-auto py-0 md:block">
        <Table>
          <TableHeader><TableRow><TableHead className="pl-4">Código</TableHead><TableHead>Cliente</TableHead><TableHead>Quadra</TableHead><TableHead>Data</TableHead><TableHead>Horário</TableHead><TableHead className="hidden 2xl:table-cell">Modalidade</TableHead><TableHead>Categoria</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Status</TableHead><TableHead>Financeiro</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.id} className="cursor-pointer" onClick={() => setDetail(b)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setDetail(b)}>
                <TableCell className="pl-4 font-mono text-xs">{b.code}</TableCell>
                <TableCell className="font-medium">{bookingTitle(b)}</TableCell>
                <TableCell>{byId.get(b.court_id)?.name}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtDateBR(localParts(tz, b.starts_at).date)}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtRange(tz, b.starts_at, b.ends_at)}</TableCell>
                <TableCell className="hidden 2xl:table-cell">{b.sport ? sportLabel(b.sport) : "—"}</TableCell>
                <TableCell><span className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("size-2.5 rounded-full", KIND_STYLE[b.kind].dot)} />{KIND_LABEL[b.kind]}</span></TableCell>
                <TableCell className="text-right tabular-nums">{b.kind === "bloqueio" ? "—" : formatBRL(b.price_cents / 100)}</TableCell>
                <TableCell><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", stCls(b.status))}>{STATUS_LABEL[b.status]}</span></TableCell>
                <TableCell>{b.kind === "bloqueio" ? "—" : PAY_STATUS_LABEL[b.payment_status]}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">Nenhuma reserva neste período.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <ul className="space-y-2 md:hidden">
        {rows.map((b) => (
          <li key={b.id}><button type="button" onClick={() => setDetail(b)} className="w-full rounded-xl border bg-card p-3 text-left">
            <div className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate font-semibold">{bookingTitle(b)}</span><span className="block text-xs text-muted-foreground">{b.code} · {byId.get(b.court_id)?.name}</span></span><span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", stCls(b.status))}>{STATUS_LABEL[b.status]}</span></div>
            <p className="mt-1 text-sm">{fmtDateBR(localParts(tz, b.starts_at).date)} · {fmtRange(tz, b.starts_at, b.ends_at)}</p>
            <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span aria-hidden className={cn("size-2.5 rounded-full", KIND_STYLE[b.kind].dot)} />{KIND_LABEL[b.kind]}{b.kind !== "bloqueio" && ` · ${formatBRL(b.price_cents / 100)} · ${PAY_STATUS_LABEL[b.payment_status]}`}</p>
          </button></li>
        ))}
        {rows.length === 0 && <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma reserva neste período.</li>}
      </ul>

      <BookingFormDialog open={create} onClose={() => setCreate(false)} ctx={ctx} />
      <BookingFormDialog open={!!edit} onClose={() => setEdit(null)} ctx={ctx} editing={edit} />
      <DetailDialog booking={detail} onClose={() => setDetail(null)} ctx={ctx} onEdit={(b) => { setDetail(null); setEdit(b) }} />
    </>
  )
}
