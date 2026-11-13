"use client"

import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLoad } from "@/hooks/use-load"
import { formatBRL } from "@/lib/format"
import { supabase } from "@/lib/supabase/client"
import { slugify } from "@/lib/tenant"
import { Download } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "sonner"

type Overview = {
  orgs_total: number; orgs_teste: number; orgs_ativa: number; orgs_suspensa: number; orgs_cancelada: number
  new_30d: number; trials_expiring: number; mrr_cents: number; athletes_total: number
  by_plan: { plan: string; orgs: number; mrr_cents: number }[]
}
type Org = {
  id: string; slug: string; name: string; status: string; plan_code: string; plan_name: string; plan_price_cents: number; athletes: number; athletes_limit: number | null
  admins: number; matches: number; created_at: string; trial_ends_at: string | null; paid_until: string | null; last_activity: string | null; last_access: string | null
  notes: string | null; status_reason: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null; cancelled_at: string | null
}
type Dash = {
  overdue: number; trials_expired: number; new_month: number; cancelled_month: number; inactive_30d: number
  growth: { month: string; novos: number; total: number }[]; mrr: { month: string; mrr_cents: number; ativas: number }[]
}
type Plan = { code: string; name: string; price_cents: number; max_athletes: number | null; active: boolean; sort_order: number; orgs: number }
type Data = { overview: Overview; orgs: Org[]; plans: Plan[]; dash: Dash }

const STATUS: Record<string, string> = { teste: "Em teste", ativa: "Ativa", suspensa: "Suspensa", cancelada: "Cancelada", excluida: "Excluída" }
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—")
const PAGE = 15
const DAY = 86_400_000
const BADGE: Record<string, string> = {
  teste: "bg-blue-100 text-blue-800", ativa: "bg-green-100 text-green-800", suspensa: "bg-amber-100 text-amber-900", cancelada: "bg-slate-200 text-slate-700", excluida: "bg-red-100 text-red-800",
}
const mes = (m: string) => { const [y, n] = m.split("-"); return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(n) - 1]}/${y.slice(2)}` }
/** Vencimento: fim do teste (em teste) ou fim do período pago (ativa). */
const dueOf = (g: Org) => (g.status === "teste" ? g.trial_ends_at : g.status === "ativa" ? g.paid_until : null)
const inactive = (g: Org) => (g.status === "ativa" || g.status === "teste") && Date.now() - new Date(g.created_at).getTime() > 30 * DAY && (!g.last_access || Date.now() - new Date(g.last_access).getTime() > 30 * DAY)
const whats = (v: string | null) => { const d = (v ?? "").replace(/\D/g, ""); return d ? `https://wa.me/${d.length <= 11 ? "55" + d : d}` : null }

function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[status] ?? "bg-secondary"}`}>{STATUS[status] ?? status}</span>
}

function csvCell(v: unknown) { const t = v == null ? "" : String(v); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
function exportCsv(rows: Org[]) {
  const head = ["Grupo", "Endereço", "Responsável", "E-mail", "WhatsApp", "Plano", "Cadastro", "Vencimento", "Atletas", "Limite", "Situação", "Motivo", "Último acesso"]
  const lines = rows.map((g) => [g.name, g.slug, g.contact_name, g.contact_email, g.contact_phone, g.plan_name, dt(g.created_at), dt(dueOf(g)), g.athletes, g.athletes_limit ?? "ilimitado", STATUS[g.status] ?? g.status, g.status_reason, dt(g.last_access)].map(csvCell).join(";"))
  const blob = new Blob(["\ufeff" + [head.join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob); a.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  URL.revokeObjectURL(a.href)
}

const CHART_TIP = { borderRadius: 8, border: "1px solid #E1E7EF", fontSize: 12 }
function GrowthChart({ data }: { data: Dash["growth"] }) {
  const d = data.map((x) => ({ ...x, mes: mes(x.month) }))
  return (
    <div className="h-52" role="img" aria-label="Crescimento de clientes por mês">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={d} margin={{ left: -16, right: 8, top: 4 }}>
          <CartesianGrid vertical={false} stroke="#E1E7EF" />
          <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#5C6B80" }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#5C6B80" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={CHART_TIP} />
          <Area type="monotone" dataKey="total" name="Clientes (acumulado)" stroke="#1E3A5F" fill="#1E3A5F" fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
function MrrChart({ data }: { data: Dash["mrr"] }) {
  const d = data.map((x) => ({ ...x, mes: mes(x.month), mrr: x.mrr_cents / 100 }))
  return (
    <div className="h-52" role="img" aria-label="Evolução do faturamento recorrente por mês">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d} margin={{ left: -8, right: 8, top: 4 }}>
          <CartesianGrid vertical={false} stroke="#E1E7EF" />
          <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#5C6B80" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: "#5C6B80" }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => formatBRL(Number(v))} contentStyle={CHART_TIP} cursor={{ fill: "rgb(30 58 95 / 0.05)" }} />
          <Bar dataKey="mrr" name="MRR" fill="#1E3A5F" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Dados de contato do responsável (só o dono da plataforma vê). */
function ContactDialog({ org, onClose, onSaved }: { org: Org | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = React.useState({ name: "", email: "", phone: "" })
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (org) setV({ name: org.contact_name ?? "", email: org.contact_email ?? "", phone: org.contact_phone ?? "" }) }, [org])
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!org) return
    setBusy(true)
    const { error } = await supabase().rpc("sa_set_contact", { p_org: org.id, p_name: v.name, p_email: v.email, p_phone: v.phone })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Contato salvo."); onSaved(); onClose()
  }
  return (
    <Dialog open={!!org} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Responsável — {org?.name}</DialogTitle><DialogDescription>Contato comercial do grupo, visível só para você.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          <div className="space-y-1.5"><Label htmlFor="c-n">Nome do responsável</Label><Input id="c-n" maxLength={120} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="c-e">E-mail</Label><Input id="c-e" type="email" maxLength={160} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="c-p">WhatsApp</Label><Input id="c-p" inputMode="tel" maxLength={30} placeholder="(11) 99999-0000" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></div>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>Salvar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

async function load(): Promise<Data> {
  const db = supabase()
  const [o, g, p, d] = await Promise.all([db.rpc("sa_overview"), db.rpc("sa_orgs"), db.rpc("sa_plans"), db.rpc("sa_dashboard", { p_months: 12 })])
  const e = o.error ?? g.error ?? p.error ?? d.error
  if (e) throw new Error(e.message)
  return { overview: o.data as Overview, orgs: g.data as Org[], plans: p.data as Plan[], dash: d.data as Dash }
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-2xl font-bold tabular-nums text-primary">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** Painel do dono da plataforma: só números agregados por grupo (nunca dados internos dos grupos). */
export default function SuperPage() {
  const { data, error, loading, reload } = useLoad(load, [])
  const [filter, setFilter] = React.useState("")
  const [q, setQ] = React.useState("")
  const [planF, setPlanF] = React.useState("")
  const [sort, setSort] = React.useState<{ key: string; dir: 1 | -1 }>({ key: "created_at", dir: -1 })
  const [page, setPage] = React.useState(0)
  const [edit, setEdit] = React.useState<Org | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [nw, setNw] = React.useState({ name: "", slug: "", plan: "teste", email: "" })

  async function act(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setBusy(true)
    const { error } = await fn()
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(ok)
    reload()
  }
  const db = () => supabase()

  if (error) return <p role="alert" className="text-sm text-destructive">{/Acesso restrito/.test(error) ? "Acesso restrito ao dono da plataforma." : `Erro ao carregar: ${error}`}</p>
  if (loading && !data) return <Skeleton className="h-60" />
  if (!data) return null
  const { overview: o, orgs, plans, dash } = data
  const val = (g: Org): string | number => {
    switch (sort.key) {
      case "name": return g.name.toLowerCase()
      case "athletes": return g.athletes
      case "due": return dueOf(g) ?? ""
      case "last_access": return g.last_access ?? ""
      case "plan": return g.plan_name.toLowerCase()
      case "status": return g.status
      default: return g.created_at
    }
  }
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  const filtered = orgs
    .filter((g) => (filter ? g.status === filter : g.status !== "excluida") && (!planF || g.plan_code === planF) && (!q || norm([g.name, g.slug, g.contact_name, g.contact_email, g.contact_phone].join(" ")).includes(norm(q))))
    .sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir)
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const cur = Math.min(page, pages - 1)
  const shown = filtered.slice(cur * PAGE, cur * PAGE + PAGE)
  const th = (key: string, label: string, cls = "") => (
    <TableHead className={cls}><button type="button" className="inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => { setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 })); setPage(0) }}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button></TableHead>
  )
  const actions = (g: Org) => g.status === "excluida" ? (
    <div className="flex justify-end max-2xl:justify-start"><Link href={`/super/clientes/${g.id}`} className="text-sm text-primary hover:underline">Recuperar ou excluir definitivamente</Link></div>
  ) : (
    <div className="flex flex-wrap justify-end gap-1.5 pr-2 max-2xl:justify-start max-2xl:pr-0">
                    {g.status === "suspensa" || g.status === "cancelada"
                      ? <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => db().rpc("sa_set_org_status", { p_org: g.id, p_status: "ativa", p_reason: null }), "Grupo reativado.")}>Reativar</Button>
                      : <Button size="sm" variant="outline" disabled={busy} onClick={() => { const r = window.prompt(`Suspender “${g.name}”? O grupo perde o acesso imediatamente. Motivo (opcional):`); if (r !== null) act(() => db().rpc("sa_set_org_status", { p_org: g.id, p_status: "suspensa", p_reason: r }), "Grupo suspenso.") }}>Suspender</Button>}
                    {g.status === "teste" && <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => db().rpc("sa_extend_trial", { p_org: g.id, p_days: 7 }), "Teste estendido em 7 dias.")}>+7 dias</Button>}
                    {g.status === "teste" && <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => db().rpc("sa_set_org_status", { p_org: g.id, p_status: "ativa", p_reason: null }), "Grupo ativado.")}>Ativar</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setEdit(g)}>Contato</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const n = window.prompt("Anotação interna (só você vê):", g.notes ?? ""); if (n !== null) act(() => db().rpc("sa_set_notes", { p_org: g.id, p_notes: n }), "Anotação salva.") }}>Nota</Button>
                  </div>
  )
  const maxMrr = Math.max(1, ...o.by_plan.map((x) => x.mrr_cents))

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel do SaaS</h1>
          <p className="text-sm text-muted-foreground">Visão do dono da plataforma. Nomes de atletas e pagamentos dos grupos não aparecem aqui.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Total de clientes" value={String(o.orgs_total)} hint={`${o.athletes_total} atletas ativos`} />
        <Kpi label="Clientes ativos" value={String(o.orgs_ativa)} hint="pagantes" />
        <Kpi label="Clientes suspensos" value={String(o.orgs_suspensa)} hint={`${o.orgs_cancelada} cancelados no total`} />
        <Kpi label="Em período de teste" value={String(o.orgs_teste)} hint={o.trials_expiring ? `${o.trials_expiring} vencendo em 3 dias` : dash.trials_expired ? `${dash.trials_expired} expirado(s)` : undefined} />
        <Kpi label="Assinaturas vencidas" value={String(dash.overdue)} hint="suspensos por inadimplência" />
        <Kpi label="MRR (receita recorrente)" value={formatBRL(o.mrr_cents / 100)} hint={`ARR ${formatBRL((o.mrr_cents * 12) / 100)}`} />
        <Kpi label="Novos clientes no mês" value={String(dash.new_month)} hint={`${o.new_30d} em 30 dias`} />
        <Kpi label="Cancelamentos do mês" value={String(dash.cancelled_month)} hint={dash.inactive_30d ? `${dash.inactive_30d} sem acesso há 30 dias` : undefined} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card><CardContent className="space-y-2 pt-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Crescimento de clientes</h2>
          <GrowthChart data={dash.growth} />
        </CardContent></Card>
        <Card><CardContent className="space-y-2 pt-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Evolução do faturamento (MRR)</h2>
          <MrrChart data={dash.mrr} />
          <p className="text-xs text-muted-foreground">O histórico do MRR começa a ser registrado a partir de hoje; meses anteriores não existem no sistema.</p>
        </CardContent></Card>
      </div>

      <Card><CardContent className="space-y-2 pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Receita por plano</h2>
        {o.by_plan.map((x) => (
          <div key={x.plan} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-sm sm:flex">
            <span className="truncate sm:w-40 sm:shrink-0">{x.plan}</span>
            <span className="text-right tabular-nums sm:order-3 sm:w-40 sm:shrink-0">{formatBRL(x.mrr_cents / 100)} · {x.orgs} grupo(s)</span>
            <div className="col-span-2 h-3 overflow-hidden rounded bg-secondary sm:order-2 sm:col-auto sm:flex-1"><div className="h-full bg-primary" style={{ width: `${(x.mrr_cents / maxMrr) * 100}%` }} /></div>
          </div>
        ))}
      </CardContent></Card>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold uppercase tracking-wide text-primary">Gerenciar clientes ({filtered.length})</h2>
        <Input aria-label="Buscar cliente" className="h-10 w-full sm:h-8 sm:w-56" placeholder="Nome, responsável, e-mail…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
        <NativeSelect aria-label="Situação" className="h-10 w-full sm:h-8 sm:w-auto" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0) }}>
          <option value="">Todas (sem excluídos)</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Plano" className="h-10 w-full sm:h-8 sm:w-auto" value={planF} onChange={(e) => { setPlanF(e.target.value); setPage(0) }}>
          <option value="">Todos os planos</option>
          {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
        </NativeSelect>
        <Button size="sm" variant="outline" className="h-10 sm:h-8" disabled={!filtered.length} onClick={() => exportCsv(filtered)}><Download /> CSV</Button>
      </div>
      <Card className="hidden overflow-x-auto py-0 2xl:block">
        <Table>
          <TableHeader><TableRow>
            {th("name", "Grupo", "pl-4")}<TableHead>Responsável</TableHead>{th("plan", "Plano")}{th("created_at", "Cadastro")}{th("due", "Vencimento")}
            {th("athletes", "Atletas", "text-center")}{th("status", "Situação")}{th("last_access", "Último acesso")}<TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {shown.map((g) => {
              const full = g.athletes_limit != null && g.athletes >= g.athletes_limit
              const wa = whats(g.contact_phone)
              return (
                <TableRow key={g.id}>
                  <TableCell className="pl-4"><Link href={`/super/clientes/${g.id}`} className="font-medium text-primary hover:underline">{g.name}</Link><div className="text-xs text-muted-foreground">{g.slug}{g.notes ? ` · ${g.notes}` : ""}</div></TableCell>
                  <TableCell className="text-xs">
                    {g.contact_name || g.contact_email || g.contact_phone ? <>
                      <div className="font-medium">{g.contact_name ?? "—"}</div>
                      <div className="text-muted-foreground">{g.contact_email}</div>
                      {wa && <a href={wa} target="_blank" rel="noreferrer" className="text-primary hover:underline">{g.contact_phone}</a>}
                    </> : <button type="button" className="text-primary hover:underline" onClick={() => setEdit(g)}>Adicionar contato</button>}
                  </TableCell>
                  <TableCell>
                    <NativeSelect aria-label={`Plano de ${g.name}`} className="h-7 text-xs" value={g.plan_code} disabled={busy}
                      onChange={(e) => act(() => db().rpc("sa_set_org_plan", { p_org: g.id, p_plan: e.target.value }), "Plano alterado.")}>
                      {plans.filter((p) => p.active || p.code === g.plan_code).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                    </NativeSelect>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{dt(g.created_at)}</TableCell>
                  <TableCell className="whitespace-nowrap">{dt(dueOf(g))}</TableCell>
                  <TableCell className={`text-center tabular-nums ${full ? "font-semibold text-destructive" : ""}`}>{g.athletes}{g.athletes_limit != null ? ` / ${g.athletes_limit}` : ""}</TableCell>
                  <TableCell><StatusBadge status={g.status} />{g.status_reason && <div className="mt-0.5 max-w-40 text-xs text-muted-foreground">{g.status_reason}</div>}</TableCell>
                  <TableCell className="whitespace-nowrap">{dt(g.last_access)}{inactive(g) && <div className="text-xs text-amber-700">inativo</div>}</TableCell>
                  <TableCell>{actions(g)}</TableCell>
                </TableRow>
              )
            })}
            {shown.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">Nenhum cliente encontrado com esses filtros.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 2xl:hidden">
        {shown.map((g) => {
          const full = g.athletes_limit != null && g.athletes >= g.athletes_limit
          const wa = whats(g.contact_phone)
          return (
            <Card key={g.id}><CardContent className="space-y-3 pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><Link href={`/super/clientes/${g.id}`} className="block truncate font-semibold text-primary hover:underline">{g.name}</Link><div className="truncate text-xs text-muted-foreground">{g.slug}{g.notes ? ` · ${g.notes}` : ""}</div></div>
                <StatusBadge status={g.status} />
              </div>
              {g.status_reason && <p className="text-xs text-muted-foreground">{g.status_reason}</p>}
              <div className="text-xs">
                {g.contact_name || g.contact_email || g.contact_phone ? <>
                  <span className="font-medium">{g.contact_name ?? "Responsável"}</span>{g.contact_email ? ` · ${g.contact_email}` : ""}
                  {wa && <> · <a href={wa} target="_blank" rel="noreferrer" className="text-primary hover:underline">{g.contact_phone}</a></>}
                </> : <span className="text-muted-foreground">Sem contato do responsável</span>}
                {" "}<button type="button" className="text-primary hover:underline" onClick={() => setEdit(g)}>editar</button>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-secondary/60 py-2"><dd className={`text-base font-semibold tabular-nums ${full ? "text-destructive" : ""}`}>{g.athletes}{g.athletes_limit != null ? `/${g.athletes_limit}` : ""}</dd><dt className="text-muted-foreground">Atletas</dt></div>
                <div className="rounded-lg bg-secondary/60 py-2"><dd className="text-base font-semibold tabular-nums">{g.admins}</dd><dt className="text-muted-foreground">Admins</dt></div>
                <div className="rounded-lg bg-secondary/60 py-2"><dd className="text-base font-semibold tabular-nums">{g.matches}</dd><dt className="text-muted-foreground">Jogos</dt></div>
              </dl>
              <p className="text-xs text-muted-foreground">Cadastro {dt(g.created_at)}{dueOf(g) ? ` · vence ${dt(dueOf(g))}` : ""} · último acesso {dt(g.last_access)}{inactive(g) ? " (inativo)" : ""}</p>
              <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Plano</span>
                <NativeSelect aria-label={`Plano de ${g.name}`} className="h-10 flex-1" value={g.plan_code} disabled={busy}
                  onChange={(e) => act(() => db().rpc("sa_set_org_plan", { p_org: g.id, p_plan: e.target.value }), "Plano alterado.")}>
                  {plans.filter((p) => p.active || p.code === g.plan_code).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </NativeSelect></label>
              {actions(g)}
            </CardContent></Card>
          )
        })}
        {shown.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground md:col-span-2">Nenhum cliente encontrado com esses filtros.</p>}
      </div>
      {filtered.length > PAGE && (
        <nav aria-label="Paginação" className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{cur * PAGE + 1}–{Math.min(filtered.length, cur * PAGE + PAGE)} de {filtered.length}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Anterior</Button>
            <Button size="sm" variant="outline" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Próxima</Button>
          </div>
        </nav>
      )}
      <ContactDialog org={edit} onClose={() => setEdit(null)} onSaved={reload} />

      <Card><CardContent className="space-y-3 pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Novo grupo</h2>
        <form className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4" onSubmit={(e) => { e.preventDefault(); act(async () => {
          const r = await db().rpc("sa_create_org", { p_slug: nw.slug, p_name: nw.name, p_plan: nw.plan })
          if (r.error || !nw.email.trim()) return r
          return db().rpc("sa_assign_admin", { p_org: r.data as string, p_email: nw.email.trim() })
        }, "Grupo criado.").then(() => setNw({ name: "", slug: "", plan: "teste", email: "" })) }}>
          <div className="space-y-1.5"><Label htmlFor="nn">Nome</Label><Input id="nn" required maxLength={80} value={nw.name} onChange={(e) => setNw((x) => ({ ...x, name: e.target.value, slug: slugify(e.target.value) }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="ns">Endereço</Label><Input id="ns" required maxLength={40} value={nw.slug} onChange={(e) => setNw((x) => ({ ...x, slug: slugify(e.target.value) }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="np">Plano</Label>
            <NativeSelect id="np" className="w-full" value={nw.plan} onChange={(e) => setNw((x) => ({ ...x, plan: e.target.value }))}>{plans.filter((p) => p.active).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="ne">E-mail do administrador <span className="font-normal text-muted-foreground">(conta já cadastrada)</span></Label><Input id="ne" type="email" value={nw.email} onChange={(e) => setNw((x) => ({ ...x, email: e.target.value }))} /></div>
          <div className="sm:col-span-2 2xl:col-span-4"><Button type="submit" variant="brand" disabled={busy}>Criar grupo</Button></div>
        </form>
      </CardContent></Card>

      <Card><CardContent className="space-y-3 pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Planos</h2>
        <p className="text-xs text-muted-foreground">Os valores iniciais são exemplos: ajuste preço e limite de atletas. Limite vazio = ilimitado. Plano desativado some das escolhas, mas os grupos que já o usam continuam nele.</p>
        <div className="space-y-2">
          {plans.map((p) => <PlanRow key={p.code} p={p} busy={busy} onSave={(v) => act(() => db().rpc("sa_upsert_plan", { p_code: p.code, p_name: v.name, p_price_cents: v.price, p_max_athletes: v.max, p_active: v.active }), "Plano salvo.")} />)}
          <PlanRow key="novo" p={{ code: "", name: "", price_cents: 0, max_athletes: null, active: true, sort_order: 0, orgs: 0 }} busy={busy} isNew onSave={(v) => act(() => db().rpc("sa_upsert_plan", { p_code: v.code, p_name: v.name, p_price_cents: v.price, p_max_athletes: v.max, p_active: v.active }), "Plano criado.")} />
        </div>
      </CardContent></Card>
    </>
  )
}

function PlanRow({ p, busy, onSave, isNew }: { p: Plan; busy: boolean; isNew?: boolean; onSave: (v: { code: string; name: string; price: number; max: number | null; active: boolean }) => void }) {
  const [v, setV] = React.useState({ code: p.code, name: p.name, price: (p.price_cents / 100).toFixed(2), max: p.max_athletes == null ? "" : String(p.max_athletes), active: p.active })
  const save = () => {
    const price = Math.round(Number(v.price.replace(",", ".")) * 100)
    if (!Number.isFinite(price) || price < 0) return toast.error("Preço inválido.")
    const max = v.max.trim() === "" ? null : Number(v.max)
    if (max != null && (!Number.isInteger(max) || max < 1)) return toast.error("Limite de atletas inválido.")
    if (isNew && !/^[a-z0-9_]{2,30}$/.test(v.code)) return toast.error("Código: 2 a 30 letras minúsculas, números ou _.")
    onSave({ code: v.code, name: v.name.trim(), price, max, active: v.active })
    if (isNew) setV({ code: "", name: "", price: "0.00", max: "", active: true })
  }
  return (
    <div className="grid items-end gap-2 rounded-xl border p-3 2xl:grid-cols-[8rem_1fr_7rem_7rem_auto_auto] 2xl:rounded-none 2xl:border-0 2xl:p-0">
      {isNew ? <Input aria-label="Código do novo plano" placeholder="código" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /> : <span className="text-xs text-muted-foreground">{p.code} · {p.orgs} grupo(s)</span>}
      <label className="space-y-1 text-xs text-muted-foreground 2xl:space-y-0"><span className="2xl:sr-only">Nome do plano</span><Input aria-label="Nome do plano" placeholder="Nome" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
      <label className="space-y-1 text-xs text-muted-foreground 2xl:space-y-0"><span className="2xl:sr-only">Preço mensal (R$)</span><Input aria-label="Preço mensal (R$)" inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} /></label>
      <label className="space-y-1 text-xs text-muted-foreground 2xl:space-y-0"><span className="2xl:sr-only">Limite de atletas</span><Input aria-label="Limite de atletas" inputMode="numeric" placeholder="ilimitado" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} /></label>
      <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Ativo</label>
      <Button size="sm" variant="outline" disabled={busy || !v.name.trim()} onClick={save}>{isNew ? "Criar" : "Salvar"}</Button>
    </div>
  )
}
