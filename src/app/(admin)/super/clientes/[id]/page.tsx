"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useLoad } from "@/hooks/use-load"
import { formatBRL } from "@/lib/format"
import { supabase } from "@/lib/supabase/client"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

type Detail = {
  org: {
    id: string; slug: string; name: string; status: string; created_at: string; trial_ends_at: string | null; cancelled_at: string | null
    logo_url: string | null; primary_color: string | null; website: string | null; tagline: string | null; card_footer: string | null
    status_reason: string | null; notes: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null
    plan_code: string; plan_name: string; plan_price_cents: number; plan_max_athletes: number | null
  }
  usage: { athletes_active: number; athletes_total: number; users_total: number; users_active: number; matches: number; matches_30d: number; by_role: Record<string, number> }
  staff: { name: string; email: string; role: string; active: boolean; last_access: string | null }[]
  billing: { paid_until?: string | null; last_event?: string | null; updated_at?: string; has_subscription?: boolean; plan_code?: string | null }
  access: { day: string; users: number; hits: number }[]
  changes: { at: string; action: string; detail: Record<string, unknown> | null }[]
}

const STATUS: Record<string, string> = { teste: "Em teste", ativa: "Ativa", suspensa: "Suspensa", cancelada: "Cancelada" }
const BADGE: Record<string, string> = { teste: "bg-blue-100 text-blue-800", ativa: "bg-green-100 text-green-800", suspensa: "bg-amber-100 text-amber-900", cancelada: "bg-slate-200 text-slate-700" }
const ROLE: Record<string, string> = { admin: "Administrador", diretoria: "Diretoria", atleta: "Atleta" }
const ACTION: Record<string, string> = {
  SA_SET_STATUS: "Situação alterada", SA_SET_PLAN: "Plano alterado", SA_EXTEND_TRIAL: "Teste estendido", SA_CREATE_ORG: "Grupo criado",
  SA_ASSIGN_ADMIN: "Administrador vinculado", SA_SET_CONTACT: "Contato do responsável alterado", SA_UPDATE_ORG: "Cadastro/identidade alterados",
}
const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—")
const dtm = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
const whats = (v: string | null) => { const d = (v ?? "").replace(/\D/g, ""); return d ? `https://wa.me/${d.length <= 11 ? "55" + d : d}` : null }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm font-medium">{children || "—"}</dd></div>
}
function Meter({ value, max, label }: { value: number; max: number | null; label: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums">{value}{max ? ` / ${max}` : " (sem limite)"}</span></div>
      {max ? <div className="h-2 overflow-hidden rounded bg-secondary" role="img" aria-label={`${label}: ${value} de ${max}`}><div className={`h-full ${pct >= 100 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div> : null}
    </div>
  )
}

export default function ClientePage() {
  const { id } = useParams<{ id: string }>()
  const { data, error, loading, reload } = useLoad(async () => {
    const r = await supabase().rpc("sa_org_detail", { p_org: id })
    if (r.error) throw new Error(r.error.message)
    return r.data as Detail
  }, [id])
  const [busy, setBusy] = React.useState(false)
  const [f, setF] = React.useState({ name: "", website: "", tagline: "", color: "", logo: "", footer: "" })
  const [c, setC] = React.useState({ name: "", email: "", phone: "" })
  React.useEffect(() => {
    if (!data) return
    const o = data.org
    setF({ name: o.name, website: o.website ?? "", tagline: o.tagline ?? "", color: o.primary_color ?? "", logo: o.logo_url ?? "", footer: o.card_footer ?? "" })
    setC({ name: o.contact_name ?? "", email: o.contact_email ?? "", phone: o.contact_phone ?? "" })
  }, [data])

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setBusy(true)
    const { error } = await fn()
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(ok); reload()
  }
  const db = () => supabase()

  if (error) return <p role="alert" className="text-sm text-destructive">{/Acesso restrito/.test(error) ? "Acesso restrito ao dono da plataforma." : `Erro ao carregar: ${error}`}</p>
  if (loading && !data) return <Skeleton className="h-60" />
  if (!data) return null
  const { org: o, usage: u, staff, billing: b, access, changes } = data
  const wa = whats(o.contact_phone)
  const suspended = o.status === "suspensa" || o.status === "cancelada"

  return (
    <>
      <div className="space-y-2">
        <Link href="/super" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Voltar aos clientes</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">{o.name}
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[o.status] ?? "bg-secondary"}`}>{STATUS[o.status] ?? o.status}</span></h1>
            <p className="text-sm text-muted-foreground">{o.slug} · {o.plan_name} · cliente desde {dt(o.created_at)}</p>
            {o.status_reason && <p className="text-sm text-amber-800">Motivo: {o.status_reason}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {suspended
              ? <Button variant="outline" disabled={busy} onClick={() => run(() => db().rpc("sa_set_org_status", { p_org: o.id, p_status: "ativa", p_reason: null }), "Cliente reativado.")}>Reativar</Button>
              : <Button variant="outline" disabled={busy} onClick={() => { const r = window.prompt(`Suspender “${o.name}”? O acesso é bloqueado na hora e os dados são preservados. Motivo:`); if (r !== null) run(() => db().rpc("sa_set_org_status", { p_org: o.id, p_status: "suspensa", p_reason: r }), "Cliente suspenso.") }}>Suspender acesso</Button>}
            {o.status === "teste" && <Button variant="outline" disabled={busy} onClick={() => run(() => db().rpc("sa_extend_trial", { p_org: o.id, p_days: 7 }), "Teste estendido em 7 dias.")}>+7 dias de teste</Button>}
          </div>
        </div>
      </div>

      <Tabs defaultValue="geral">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="geral">Visão geral</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários e atletas</TabsTrigger>
          <TabsTrigger value="assinatura">Assinatura</TabsTrigger>
          <TabsTrigger value="config">Configurações</TabsTrigger>
          <TabsTrigger value="atividades">Atividades</TabsTrigger>
        </TabsList>

        <TabsContent value="geral" className="space-y-3">
          <Card><CardContent className="space-y-4 pt-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Dados cadastrais</h2>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Responsável">{o.contact_name}</Field>
              <Field label="E-mail">{o.contact_email}</Field>
              <Field label="WhatsApp">{wa ? <a href={wa} target="_blank" rel="noreferrer" className="text-primary hover:underline">{o.contact_phone}</a> : o.contact_phone}</Field>
              <Field label="Plano">{o.plan_name} · {formatBRL(o.plan_price_cents / 100)}/mês</Field>
              <Field label="Cadastro">{dt(o.created_at)}</Field>
              <Field label="Site">{o.website}</Field>
            </dl>
          </CardContent></Card>
          <Card><CardContent className="space-y-3 pt-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Utilização</h2>
            <Meter label="Atletas ativos" value={u.athletes_active} max={o.plan_max_athletes} />
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Usuários ativos">{String(u.users_active)}</Field>
              <Field label="Jogos cadastrados">{String(u.matches)}</Field>
              <Field label="Jogos (30 dias)">{String(u.matches_30d)}</Field>
              <Field label="Último acesso">{dt(access[0]?.day)}</Field>
            </dl>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="usuarios" className="space-y-3">
          <Card><CardContent className="space-y-3 pt-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Limites e quantidades</h2>
            <Meter label="Atletas ativos" value={u.athletes_active} max={o.plan_max_athletes} />
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Atletas (total)">{String(u.athletes_total)}</Field>
              <Field label="Administradores">{String(u.by_role.admin ?? 0)}</Field>
              <Field label="Diretoria">{String(u.by_role.diretoria ?? 0)}</Field>
              <Field label="Atletas com login">{String(u.by_role.atleta ?? 0)}</Field>
            </dl>
          </CardContent></Card>
          <Card><CardContent className="space-y-2 pt-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Equipe administrativa</h2>
            <p className="text-xs text-muted-foreground">Nomes de atletas não são exibidos ao dono da plataforma.</p>
            {staff.length === 0 && <p className="text-sm text-muted-foreground">Nenhum administrador vinculado.</p>}
            <ul className="divide-y">
              {staff.map((s) => (
                <li key={s.email} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.email}</div></div>
                  <div className="text-right text-xs text-muted-foreground">{ROLE[s.role] ?? s.role}{s.active ? "" : " · inativo"}<div>último acesso {dt(s.last_access)}</div></div>
                </li>
              ))}
            </ul>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="assinatura" className="space-y-3">
          <Card><CardContent className="space-y-4 pt-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Assinatura</h2>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Plano">{o.plan_name}</Field>
              <Field label="Valor mensal">{formatBRL(o.plan_price_cents / 100)}</Field>
              <Field label="Situação">{STATUS[o.status] ?? o.status}</Field>
              <Field label="Fim do teste">{o.status === "teste" ? dt(o.trial_ends_at) : "—"}</Field>
              <Field label="Pago até">{dt(b.paid_until)}</Field>
              <Field label="Assinatura no Asaas">{b.has_subscription ? "Vinculada" : "Não contratada"}</Field>
              <Field label="Último evento de cobrança">{b.last_event}</Field>
              <Field label="Cancelado em">{dt(o.cancelled_at)}</Field>
            </dl>
            <p className="text-xs text-muted-foreground">O histórico detalhado de faturas fica no painel do Asaas; aqui aparecem a situação e o último evento recebido.</p>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="config" className="space-y-3">
          <Card><CardContent className="space-y-3 pt-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Cadastro e identidade visual</h2>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => db().rpc("sa_update_org", {
              p_org: o.id, p_name: f.name, p_website: f.website, p_tagline: f.tagline, p_primary_color: f.color, p_logo_url: f.logo, p_card_footer: f.footer }), "Cadastro salvo.") }}>
              <div className="space-y-1.5"><Label htmlFor="f-n">Nome do grupo</Label><Input id="f-n" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="f-w">Site</Label><Input id="f-w" maxLength={120} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="f-t">Lema</Label><Input id="f-t" maxLength={80} value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="f-c">Cor principal</Label>
                <div className="flex gap-2"><Input id="f-c" placeholder="#1E3A5F" maxLength={7} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
                  <span aria-hidden className="size-9 shrink-0 rounded-md border" style={{ background: /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : "transparent" }} /></div></div>
              <div className="space-y-1.5"><Label htmlFor="f-l">Endereço do logo (https://…)</Label><Input id="f-l" maxLength={300} value={f.logo} onChange={(e) => setF({ ...f, logo: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="f-f">Rodapé do card da escalação</Label><Input id="f-f" maxLength={100} value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} /></div>
              <div className="sm:col-span-2"><Button type="submit" variant="brand" disabled={busy}>Salvar cadastro</Button></div>
            </form>
          </CardContent></Card>
          <Card><CardContent className="space-y-3 pt-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Responsável e anotações</h2>
            <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); run(() => db().rpc("sa_set_contact", { p_org: o.id, p_name: c.name, p_email: c.email, p_phone: c.phone }), "Contato salvo.") }}>
              <div className="space-y-1.5"><Label htmlFor="r-n">Nome</Label><Input id="r-n" maxLength={120} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="r-e">E-mail</Label><Input id="r-e" type="email" maxLength={160} value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="r-p">WhatsApp</Label><Input id="r-p" inputMode="tel" maxLength={30} value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></div>
              <div className="sm:col-span-3 flex flex-wrap gap-2">
                <Button type="submit" variant="outline" disabled={busy}>Salvar contato</Button>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => { const n = window.prompt("Anotação interna (só você vê):", o.notes ?? ""); if (n !== null) run(() => db().rpc("sa_set_notes", { p_org: o.id, p_notes: n }), "Anotação salva.") }}>Anotação interna</Button>
              </div>
            </form>
            {o.notes && <p className="rounded-lg bg-secondary/60 p-3 text-sm">{o.notes}</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="atividades" className="space-y-3">
          <Card><CardContent className="space-y-2 pt-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Últimos acessos (por dia)</h2>
            {access.length === 0 && <p className="text-sm text-muted-foreground">Nenhum acesso registrado ainda.</p>}
            <ul className="divide-y text-sm">
              {access.slice(0, 15).map((a) => <li key={a.day} className="flex justify-between py-1.5"><span>{dt(a.day + "T12:00:00")}</span><span className="text-muted-foreground tabular-nums">{a.users} pessoa(s) · {a.hits} abertura(s)</span></li>)}
            </ul>
          </CardContent></Card>
          <Card><CardContent className="space-y-2 pt-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Alterações administrativas</h2>
            {changes.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma alteração administrativa registrada.</p>}
            <ul className="divide-y text-sm">
              {changes.map((a, i) => (
                <li key={i} className="py-2"><div className="font-medium">{ACTION[a.action] ?? a.action}</div>
                  <div className="text-xs text-muted-foreground">{dtm(a.at)}{a.detail && Object.keys(a.detail).length ? " · " + Object.entries(a.detail).map(([k, v]) => `${k}: ${v ?? "—"}`).join(", ") : ""}</div></li>
              ))}
            </ul>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
