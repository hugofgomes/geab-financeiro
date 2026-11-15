"use client"

import { BRAND_PRIMARY } from "@/lib/brand"

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
import { maskPhone } from "@/lib/whatsapp"
import { Menu } from "@base-ui/react/menu"
import { Download, ExternalLink, MoreHorizontal, StickyNote, UserPen } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
type Plan = { code: string; name: string; price_cents: number; max_athletes: number | null; active: boolean; sort_order: number; orgs: number; max_admins: number | null; modules: string[]; trial_days: number; gateway_ref: string | null; max_courts: number | null }
const MODULES: [string, string][] = [["importar", "Importar planilha"], ["ao_vivo", "Gols ao vivo"], ["pix", "Pix automático"], ["mensagens", "WhatsApp e e-mail"], ["quadras", "Quadra Esportiva"]]
type Data = { overview: Overview; orgs: Org[]; plans: Plan[]; dash: Dash }

const STATUS: Record<string, string> = { teste: "Em teste", ativa: "Ativa", suspensa: "Suspensa", cancelada: "Cancelada", excluida: "Excluída" }
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—")
const PAGE = 15
const DAY = 86_400_000
const BADGE: Record<string, string> = {
  teste: "bg-blue-100 text-blue-800", ativa: "bg-green-100 text-green-800", suspensa: "bg-amber-100 text-amber-900", cancelada: "bg-slate-200 text-slate-700", excluida: "bg-red-100 text-red-800",
}
const mes = (m: string) => { const [y, n] = m.split("-"); return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(n) - 1]}/${y.slice(2)}` }
/** Vencimento: fim do período pago, ou fim do teste (também para quem está no plano de teste com situação Ativa). Plano interno e clientes cancelados/excluídos não têm. */
type Due = { iso: string; kind: "paid" | "trial"; days: number }
let trialDays = 10   // dias do teste gratuito (vem do plano de teste; atualizado quando o painel carrega os planos)
const dueInfo = (g: Org): Due | null => {
  if (g.status === "excluida" || g.status === "cancelada") return null
  const calc = (iso: string, kind: Due["kind"]): Due => ({ iso, kind, days: Math.ceil((new Date(iso).getTime() - Date.now()) / DAY) })
  if (g.paid_until) return calc(g.paid_until, "paid")
  // Em teste (ou no plano de teste): fim do teste gravado; se não houver, cadastro + dias do teste. Só exibição: nada é alterado no cliente.
  if (g.status === "teste" || g.plan_code === "teste") return calc(g.trial_ends_at ?? new Date(new Date(g.created_at).getTime() + trialDays * DAY).toISOString(), "trial")
  return null
}
const dueOf = (g: Org) => dueInfo(g)?.iso ?? null
const ago = (iso: string | null) => { if (!iso) return "nunca"; const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY); return d <= 0 ? "hoje" : d === 1 ? "ontem" : d < 30 ? `há ${d} dias` : dt(iso) }
const dts = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—")
const plural = (n: number) => `${n} dia${n === 1 ? "" : "s"}`
const phoneBR = (v: string | null) => (v ? maskPhone(v.replace(/^55/, "")) : "")

/** Vencimento com a data e um selo de prazo (vermelho vencido, âmbar até 3 dias). */
function DueCell({ g }: { g: Org }) {
  const d = dueInfo(g)
  if (!d) return <span className="text-sm text-muted-foreground">{g.plan_code === "ilimitado" ? "Sem vencimento" : "—"}</span>
  const tone = d.days < 0 ? "text-red-700" : d.days <= 3 ? "text-amber-700" : "text-muted-foreground"
  const txt = d.days < 0 ? `venceu há ${plural(-d.days)}` : d.days === 0 ? "vence hoje" : `em ${plural(d.days)}`
  return (
    <div className="leading-tight" title={d.kind === "trial" ? (g.status === "ativa" ? "Fim do teste (cadastro + dias do teste). Cliente ativado: o acesso não é bloqueado nesta data" : "Fim do teste (cadastro + dias do teste)") : undefined}>
      <div className="font-medium tabular-nums">{dt(d.iso)}</div>
      <div className={`text-xs ${tone}`}>{d.kind === "trial" ? "Teste · " : ""}{txt}</div>
    </div>
  )
}
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
          <Area type="monotone" dataKey="total" name="Clientes (acumulado)" stroke={BRAND_PRIMARY} fill={BRAND_PRIMARY} fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
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
          <Bar dataKey="mrr" name="MRR" fill={BRAND_PRIMARY} radius={[4, 4, 0, 0]} isAnimationActive={false} />
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
  const [view, setView] = React.useState("")
  const router = useRouter()
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
  trialDays = plans.find((p) => p.code === "teste")?.trial_days ?? 10
  const val = (g: Org): string | number => {
    switch (sort.key) {
      case "name": return g.name.toLowerCase()
      case "athletes": return g.athletes
      case "due": return dueOf(g) ?? "9999-12-31"
      case "last_access": return g.last_access ?? ""
      case "plan": return g.plan_name.toLowerCase()
      case "status": return g.status
      default: return g.created_at
    }
  }
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  const live = orgs.filter((g) => g.status !== "excluida")
  const inView = (g: Org) => view === "" ? g.status !== "excluida" : view === "trial" ? (g.status === "teste" || g.plan_code === "teste") && g.status !== "excluida" && g.status !== "cancelada"
    : view === "venc" ? (dueInfo(g)?.days ?? 99) <= 7 : g.status === view
  const chips: [string, string, number][] = [["", "Todos", live.length], ["trial", "Em teste", live.filter((g) => (g.status === "teste" || g.plan_code === "teste") && g.status !== "cancelada").length],
    ["ativa", "Ativos", live.filter((g) => g.status === "ativa").length], ["suspensa", "Suspensos", live.filter((g) => g.status === "suspensa").length], ["cancelada", "Cancelados", live.filter((g) => g.status === "cancelada").length],
    ["venc", "Vencem em até 7 dias", live.filter((g) => (dueInfo(g)?.days ?? 99) <= 7).length]]
  const excluidos = orgs.length - live.length
  if (excluidos) chips.push(["excluida", "Excluídos", excluidos])
  const filtered = orgs
    .filter((g) => inView(g) && (!planF || g.plan_code === planF) && (!q || norm([g.name, g.slug, g.contact_name, g.contact_email, g.contact_phone].join(" ")).includes(norm(q))))
    .sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir)
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const cur = Math.min(page, pages - 1)
  const shown = filtered.slice(cur * PAGE, cur * PAGE + PAGE)
  const attention = orgs.flatMap((g) => {
    const w: string[] = []
    const di = dueInfo(g)
    if (di?.kind === "trial" && g.status !== "suspensa") { if (di.days > 0 && di.days <= 7) w.push(`teste termina em ${plural(di.days)}`); else if (di.days <= 0 && di.days > -14) w.push("teste vencido, sem assinatura") }
    if (g.status === "suspensa" && /^inadimpl/.test(g.status_reason ?? "")) w.push("pagamento em atraso")
    if (inactive(g)) w.push("sem acesso há mais de 30 dias")
    return w.map((why) => ({ g, why }))
  })
  const th = (key: string, label: string, cls = "") => (
    <TableHead className={cls}><button type="button" className="inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => { setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 })); setPage(0) }}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button></TableHead>
  )
  const itemCls = "flex w-full cursor-default items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
  /** Menu "⋯" com as ações do cliente (no lugar dos botões soltos). */
  const menu = (g: Org) => (
    <Menu.Root>
      <Menu.Trigger aria-label={`Ações de ${g.name}`} className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-secondary sm:size-9"><MoreHorizontal className="size-5" /></Menu.Trigger>
      <Menu.Portal><Menu.Positioner align="end" sideOffset={6} className="z-50"><Menu.Popup className="min-w-56 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
        <Menu.Item onClick={() => router.push(`/super/clientes/${g.id}`)} className={itemCls}><ExternalLink className="size-4" /> {g.status === "excluida" ? "Recuperar ou excluir definitivamente" : "Abrir cliente"}</Menu.Item>
        {g.status !== "excluida" && <>
          <Menu.Item onClick={() => setEdit(g)} className={itemCls}><UserPen className="size-4" /> Contato do responsável</Menu.Item>
          <Menu.Item onClick={() => { const n = window.prompt("Anotação interna (só você vê):", g.notes ?? ""); if (n !== null) act(() => db().rpc("sa_set_notes", { p_org: g.id, p_notes: n }), "Anotação salva.") }} className={itemCls}><StickyNote className="size-4" /> Anotação interna</Menu.Item>
          <Menu.Separator className="my-1 h-px bg-border" />
          {g.status === "teste" && <Menu.Item onClick={() => act(() => db().rpc("sa_extend_trial", { p_org: g.id, p_days: 7 }), "Teste estendido em 7 dias.")} className={itemCls}>+7 dias de teste</Menu.Item>}
          {g.status === "teste" && <Menu.Item onClick={() => act(() => db().rpc("sa_set_org_status", { p_org: g.id, p_status: "ativa", p_reason: null }), "Grupo ativado.")} className={itemCls}>Ativar grupo</Menu.Item>}
          {g.status === "suspensa" || g.status === "cancelada"
            ? <Menu.Item onClick={() => act(() => db().rpc("sa_set_org_status", { p_org: g.id, p_status: "ativa", p_reason: null }), "Grupo reativado.")} className={itemCls}>Reativar acesso</Menu.Item>
            : <Menu.Item onClick={() => { const r = window.prompt(`Suspender “${g.name}”? O grupo perde o acesso imediatamente. Motivo (opcional):`); if (r !== null) act(() => db().rpc("sa_set_org_status", { p_org: g.id, p_status: "suspensa", p_reason: r }), "Grupo suspenso.") }} className={`${itemCls} text-red-700`}>Suspender acesso</Menu.Item>}
        </>}
      </Menu.Popup></Menu.Positioner></Menu.Portal>
    </Menu.Root>
  )
  const contact = (g: Org) => {
    const wa = whats(g.contact_phone)
    return g.contact_name || g.contact_email || g.contact_phone ? (
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-medium">{g.contact_name ?? "Responsável"}</div>
        {g.contact_email && <div className="truncate text-xs text-muted-foreground">{g.contact_email}</div>}
        {wa && <a href={wa} target="_blank" rel="noreferrer" className="inline-block py-0.5 text-xs text-primary hover:underline">{phoneBR(g.contact_phone)}</a>}
      </div>
    ) : <button type="button" className="inline-flex min-h-8 items-center text-xs text-primary hover:underline" onClick={() => setEdit(g)}>+ Adicionar contato</button>
  }
  const athletesCell = (g: Org) => {
    const full = g.athletes_limit != null && g.athletes >= g.athletes_limit
    return (
      <div className="w-24 leading-tight">
        <div className={`text-sm tabular-nums ${full ? "font-semibold text-red-700" : "font-medium"}`}>{g.athletes}{g.athletes_limit != null && <span className="font-normal text-muted-foreground"> / {g.athletes_limit}</span>}</div>
        {g.athletes_limit != null && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden><div className={`h-full rounded-full ${full ? "bg-red-500" : "bg-primary"}`} style={{ width: `${Math.min(100, (g.athletes / g.athletes_limit) * 100)}%` }} /></div>}
      </div>
    )
  }
  const planSelect = (g: Org, cls: string) => (
    <NativeSelect aria-label={`Plano de ${g.name}`} className={cls} value={g.plan_code} disabled={busy || g.status === "excluida"}
      onChange={(e) => act(() => db().rpc("sa_set_org_plan", { p_org: g.id, p_plan: e.target.value }), "Plano alterado.")}>
      {plans.filter((p) => p.active || p.code === g.plan_code).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
    </NativeSelect>
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

      {attention.length > 0 && (
        <Card><CardContent className="space-y-2 pt-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Atenção ({attention.length})</h2>
          <ul className="divide-y text-sm">
            {attention.map((a) => (
              <li key={a.g.id + a.why} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/super/clientes/${a.g.id}`} className="font-medium text-primary hover:underline">{a.g.name}</Link>
                <span className="text-muted-foreground">{a.why}</span>
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}

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

      <div className="@container space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold uppercase tracking-wide text-primary">Gerenciar clientes <span className="font-normal text-muted-foreground">({filtered.length})</span></h2>
          <Input aria-label="Buscar cliente" className="h-10 w-full sm:h-9 sm:w-60" placeholder="Buscar nome, responsável, e-mail…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
          <NativeSelect aria-label="Plano" className="h-10 w-full sm:h-9 sm:w-auto" value={planF} onChange={(e) => { setPlanF(e.target.value); setPage(0) }}>
            <option value="">Todos os planos</option>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </NativeSelect>
          <div className="flex w-full gap-2 sm:w-auto">
            <NativeSelect aria-label="Ordenar por" className="h-10 flex-1 sm:h-9 sm:flex-none" value={sort.key} onChange={(e) => { setSort({ key: e.target.value, dir: e.target.value === "name" || e.target.value === "due" ? 1 : -1 }); setPage(0) }}>
              <option value="created_at">Mais recentes</option><option value="due">Vencimento</option><option value="name">Nome</option><option value="athletes">Atletas</option><option value="last_access">Último acesso</option>
            </NativeSelect>
            <Button size="icon" variant="outline" className="size-10 sm:size-9" aria-label={sort.dir === 1 ? "Ordem crescente" : "Ordem decrescente"} onClick={() => setSort((x) => ({ ...x, dir: x.dir === 1 ? -1 : 1 }))}>{sort.dir === 1 ? "↑" : "↓"}</Button>
            <Button size="sm" variant="outline" className="h-10 sm:h-9" disabled={!filtered.length} onClick={() => exportCsv(filtered)}><Download /> CSV</Button>
          </div>
        </div>
        <div role="tablist" aria-label="Filtrar clientes" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chips.map(([k, label, n]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => { setView(k); setPage(0) }}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm transition sm:min-h-9 ${view === k ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}>
              {label}<span className={`rounded-full px-1.5 text-xs tabular-nums ${view === k ? "bg-white/20" : "bg-secondary text-muted-foreground"}`}>{n}</span>
            </button>
          ))}
        </div>

      <Card className="hidden overflow-x-auto py-0 @5xl:block">
        <Table>
          <TableHeader><TableRow className="bg-secondary/40 hover:bg-secondary/40">
            {th("name", "Cliente", "h-11 pl-4 text-xs uppercase tracking-wide")}<TableHead className="text-xs uppercase tracking-wide">Responsável</TableHead>{th("plan", "Plano", "text-xs uppercase tracking-wide")}{th("due", "Vencimento", "text-xs uppercase tracking-wide")}
            {th("athletes", "Atletas", "text-xs uppercase tracking-wide")}{th("status", "Situação", "text-xs uppercase tracking-wide")}<TableHead className="w-14" />
          </TableRow></TableHeader>
          <TableBody>
            {shown.map((g) => (
              <TableRow key={g.id} className="align-middle">
                <TableCell className="py-3 pl-4">
                  <div className="flex items-center gap-3">
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{(g.name.trim()[0] ?? "?").toUpperCase()}</span>
                    <div className="min-w-0 leading-tight">
                      <Link href={`/super/clientes/${g.id}`} className="block max-w-40 truncate font-medium text-foreground hover:text-primary hover:underline" title={g.name}>{g.name}</Link>
                      <div className="mt-0.5 max-w-44 truncate text-xs text-muted-foreground" title={g.slug}>{g.slug}</div>
                      <div className="max-w-44 truncate text-xs text-muted-foreground">cadastro {dts(g.created_at)}</div>
                      <div className="max-w-44 truncate text-xs text-muted-foreground">acesso {ago(g.last_access)}{inactive(g) && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">inativo</span>}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-40 py-3">{contact(g)}</TableCell>
                <TableCell className="py-3">{planSelect(g, "h-8 w-36 rounded-full border-transparent bg-secondary px-2.5 text-xs font-medium")}</TableCell>
                <TableCell className="py-3 whitespace-nowrap"><DueCell g={g} /></TableCell>
                <TableCell className="py-3">{athletesCell(g)}</TableCell>
                <TableCell className="py-3"><StatusBadge status={g.status} />{g.status_reason && <div className="mt-1 max-w-24 truncate text-xs text-muted-foreground" title={g.status_reason}>{g.status_reason}</div>}</TableCell>
                <TableCell className="w-14 py-3 pr-3 text-right">{menu(g)}</TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Nenhum cliente encontrado com esses filtros.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <div className="grid gap-3 @2xl:grid-cols-2 @5xl:hidden">
        {shown.map((g) => (
          <Card key={g.id}><CardContent className="space-y-3 pt-4">
            <div className="flex items-start gap-3">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{(g.name.trim()[0] ?? "?").toUpperCase()}</span>
              <div className="min-w-0 flex-1 leading-tight">
                <Link href={`/super/clientes/${g.id}`} className="block truncate py-0.5 font-semibold hover:text-primary hover:underline">{g.name}</Link>
                <div className="truncate text-xs text-muted-foreground">{g.slug} · cadastro {dt(g.created_at)}</div>
                <div className="truncate text-xs text-muted-foreground">acesso {ago(g.last_access)}{inactive(g) ? " · inativo" : ""}</div>
              </div>
              {menu(g)}
            </div>
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={g.status} />{g.status_reason && <span className="text-xs text-muted-foreground">{g.status_reason}</span>}</div>
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-secondary/50 p-3">
              <div><div className="text-xs text-muted-foreground">Vencimento</div><DueCell g={g} /></div>
              <div><div className="text-xs text-muted-foreground">Atletas</div>{athletesCell(g)}</div>
            </div>
            <div>{contact(g)}</div>
            <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Plano</span>{planSelect(g, "h-10 flex-1 rounded-full border-transparent bg-secondary px-3 text-sm font-medium")}</label>
          </CardContent></Card>
        ))}
        {shown.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground @2xl:col-span-2">Nenhum cliente encontrado com esses filtros.</p>}
      </div>
      </div>
      {filtered.length > PAGE && (
        <nav aria-label="Paginação" className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{cur * PAGE + 1}–{Math.min(filtered.length, cur * PAGE + PAGE)} de {filtered.length}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-10 px-4 sm:h-8" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Anterior</Button>
            <Button size="sm" variant="outline" className="h-10 px-4 sm:h-8" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Próxima</Button>
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
        <details className="text-xs text-muted-foreground"><summary className="flex min-h-10 cursor-pointer items-center font-medium text-primary">Como funcionam os planos</summary><p>Limite vazio = ilimitado. Plano desativado some das escolhas de assinatura, mas os grupos que já o usam continuam nele (o Premium nasce inativo e sem preço: defina o valor e ative). Módulos desligados bloqueiam o recurso no servidor e somem do menu. A duração do teste vale para novos grupos. A referência do gateway é só um campo de preparação: a cobrança atual usa o preço do plano no Asaas.</p></details>
        <div className="space-y-2">
          {plans.map((p) => <PlanRow key={p.code} p={p} busy={busy} onSave={(v) => act(() => db().rpc("sa_upsert_plan", { p_code: p.code, p_name: v.name, p_price_cents: v.price, p_max_athletes: v.max, p_active: v.active, p_max_admins: v.admins, p_modules: v.modules, p_trial_days: v.trial, p_gateway_ref: v.gateway, p_max_courts: v.courts }), "Plano salvo.")} />)}
          <PlanRow key="novo" p={{ code: "", name: "", price_cents: 0, max_athletes: null, active: true, sort_order: 0, orgs: 0, max_admins: null, modules: MODULES.map(([k]) => k).filter((k) => k !== "quadras"), trial_days: 10, gateway_ref: null, max_courts: null }} busy={busy} isNew onSave={(v) => act(() => db().rpc("sa_upsert_plan", { p_code: v.code, p_name: v.name, p_price_cents: v.price, p_max_athletes: v.max, p_active: v.active, p_max_admins: v.admins, p_modules: v.modules, p_trial_days: v.trial, p_gateway_ref: v.gateway, p_max_courts: v.courts }), "Plano criado.")} />
        </div>
      </CardContent></Card>
    </>
  )
}

function PlanRow({ p, busy, onSave, isNew }: { p: Plan; busy: boolean; isNew?: boolean; onSave: (v: { code: string; name: string; price: number; max: number | null; active: boolean; admins: number | null; courts: number | null; modules: string[]; trial: number; gateway: string }) => void }) {
  const [v, setV] = React.useState({ code: p.code, name: p.name, price: (p.price_cents / 100).toFixed(2), max: p.max_athletes == null ? "" : String(p.max_athletes), admins: p.max_admins == null ? "" : String(p.max_admins), courts: p.max_courts == null ? "" : String(p.max_courts),
    trial: String(p.trial_days), gateway: p.gateway_ref ?? "", active: p.active, modules: p.modules })
  const save = () => {
    const price = Math.round(Number(v.price.replace(",", ".")) * 100)
    if (!Number.isFinite(price) || price < 0) return toast.error("Preço inválido.")
    const max = v.max.trim() === "" ? null : Number(v.max)
    if (max != null && (!Number.isInteger(max) || max < 1)) return toast.error("Limite de atletas inválido.")
    const admins = v.admins.trim() === "" ? null : Number(v.admins)
    if (admins != null && (!Number.isInteger(admins) || admins < 1)) return toast.error("Limite de administradores inválido.")
    const courts = v.courts.trim() === "" ? null : Number(v.courts)
    if (courts != null && (!Number.isInteger(courts) || courts < 1)) return toast.error("Limite de quadras inválido.")
    const trial = Number(v.trial)
    if (!Number.isInteger(trial) || trial < 1 || trial > 90) return toast.error("Duração do teste: de 1 a 90 dias.")
    if (isNew && !/^[a-z0-9_]{2,30}$/.test(v.code)) return toast.error("Código: 2 a 30 letras minúsculas, números ou _.")
    onSave({ code: v.code, name: v.name.trim(), price, max, active: v.active, admins, courts, modules: v.modules, trial, gateway: v.gateway })
    if (isNew) setV({ code: "", name: "", price: "0.00", max: "", admins: "", courts: "", trial: "10", gateway: "", active: true, modules: MODULES.map(([k]) => k).filter((k) => k !== "quadras") })
  }
  const toggle = (k: string) => setV((x) => ({ ...x, modules: x.modules.includes(k) ? x.modules.filter((m) => m !== k) : [...x.modules, k] }))
  const limits = [p.max_athletes == null ? "atletas ∞" : `${p.max_athletes} atletas`, p.max_admins == null ? "admins ∞" : `${p.max_admins} admin(s)`].join(" · ")
  const body = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 items-end gap-2 lg:grid-cols-4">
        {isNew ? <label className="col-span-2 space-y-1 text-xs text-muted-foreground lg:col-span-1">Código<Input aria-label="Código do novo plano" className="h-11 sm:h-9" placeholder="ex.: elite" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></label>
          : <div className="col-span-2 text-xs text-muted-foreground lg:col-span-1">{p.code} · {p.orgs} grupo(s)</div>}
        <label className="col-span-2 space-y-1 text-xs text-muted-foreground lg:col-span-1">Nome<Input aria-label="Nome do plano" className="h-11 sm:h-9" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Preço mensal (R$)<Input aria-label="Preço mensal (R$)" className="h-11 sm:h-9" inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} /></label>
        {v.modules.includes("quadras") && <label className="space-y-1 text-xs text-muted-foreground">Limite de quadras ativas<Input aria-label="Limite de quadras" className="h-11 sm:h-9" inputMode="numeric" placeholder="ilimitado" value={v.courts} onChange={(e) => setV({ ...v, courts: e.target.value })} /></label>}
        <label className="space-y-1 text-xs text-muted-foreground">Duração do teste (dias)<Input aria-label="Duração do teste em dias" className="h-11 sm:h-9" inputMode="numeric" value={v.trial} onChange={(e) => setV({ ...v, trial: e.target.value })} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Limite de atletas<Input aria-label="Limite de atletas" className="h-11 sm:h-9" inputMode="numeric" placeholder="ilimitado" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Limite de administradores<Input aria-label="Limite de administradores" className="h-11 sm:h-9" inputMode="numeric" placeholder="ilimitado" value={v.admins} onChange={(e) => setV({ ...v, admins: e.target.value })} /></label>
        <label className="col-span-2 space-y-1 text-xs text-muted-foreground">Referência no gateway (opcional)<Input aria-label="Referência do plano no gateway" className="h-11 sm:h-9" maxLength={100} value={v.gateway} onChange={(e) => setV({ ...v, gateway: e.target.value })} /></label>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs text-muted-foreground">Módulos do plano</legend>
        <div className="grid grid-cols-2 gap-x-3 sm:flex sm:flex-wrap sm:gap-x-4">
          {MODULES.map(([k, label]) => <label key={k} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8 sm:text-xs"><input type="checkbox" className="size-5 sm:size-4" checked={v.modules.includes(k)} onChange={() => toggle(k)} /> {label}</label>)}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8 sm:text-xs"><input type="checkbox" className="size-5 sm:size-4" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Ativo (à venda)</label>
        <Button size="sm" variant="outline" className="h-11 w-full sm:h-8 sm:w-auto" disabled={busy || !v.name.trim()} onClick={save}>{isNew ? "Criar plano" : "Salvar plano"}</Button>
      </div>
    </div>
  )
  return (
    <details className="group rounded-xl border p-3">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-sm [&::-webkit-details-marker]:hidden">
        <span className="min-w-0"><span className="block truncate font-medium">{isNew ? "Novo plano" : p.name}</span>
          {!isNew && <span className="block text-xs text-muted-foreground">{formatBRL(p.price_cents / 100)}/mês · {limits} · {p.orgs} grupo(s){p.active ? "" : " · inativo"}</span>}</span>
        <span aria-hidden className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="pt-3">{body}</div>
    </details>
  )
}
