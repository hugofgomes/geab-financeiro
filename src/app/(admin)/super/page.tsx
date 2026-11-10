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
import * as React from "react"
import { toast } from "sonner"

type Overview = {
  orgs_total: number; orgs_teste: number; orgs_ativa: number; orgs_suspensa: number; orgs_cancelada: number
  new_30d: number; trials_expiring: number; mrr_cents: number; athletes_total: number
  by_plan: { plan: string; orgs: number; mrr_cents: number }[]
}
type Org = {
  id: string; slug: string; name: string; status: string; plan_code: string; plan_name: string; athletes: number; athletes_limit: number | null
  admins: number; matches: number; created_at: string; trial_ends_at: string | null; last_activity: string | null; notes: string | null; status_reason: string | null
}
type Plan = { code: string; name: string; price_cents: number; max_athletes: number | null; active: boolean; sort_order: number; orgs: number }
type Data = { overview: Overview; orgs: Org[]; plans: Plan[] }

const STATUS: Record<string, string> = { teste: "Em teste", ativa: "Ativa", suspensa: "Suspensa", cancelada: "Cancelada" }
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—")

async function load(): Promise<Data> {
  const db = supabase()
  const [o, g, p] = await Promise.all([db.rpc("sa_overview"), db.rpc("sa_orgs"), db.rpc("sa_plans")])
  const e = o.error ?? g.error ?? p.error
  if (e) throw new Error(e.message)
  return { overview: o.data as Overview, orgs: g.data as Org[], plans: p.data as Plan[] }
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
  const { overview: o, orgs, plans } = data
  const shown = orgs.filter((g) => (!filter || g.status === filter) && (!q || (g.name + g.slug).toLowerCase().includes(q.toLowerCase())))
  const maxMrr = Math.max(1, ...o.by_plan.map((x) => x.mrr_cents))

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Plataforma</h1>
      <p className="text-sm text-muted-foreground">Visão do dono: números por grupo. Nomes de atletas, pagamentos e contatos dos grupos não aparecem aqui.</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Grupos" value={String(o.orgs_total)} hint={`${o.new_30d} novos em 30 dias`} />
        <Kpi label="Ativos (pagantes)" value={String(o.orgs_ativa)} />
        <Kpi label="Em teste" value={String(o.orgs_teste)} hint={o.trials_expiring ? `${o.trials_expiring} vencendo em 3 dias` : undefined} />
        <Kpi label="Suspensos / cancelados" value={`${o.orgs_suspensa} / ${o.orgs_cancelada}`} />
        <Kpi label="MRR (estimado pelos planos)" value={formatBRL(o.mrr_cents / 100)} />
        <Kpi label="ARR (MRR × 12)" value={formatBRL((o.mrr_cents * 12) / 100)} />
        <Kpi label="Atletas ativos" value={String(o.athletes_total)} />
        <Kpi label="Inadimplência" value="—" hint="disponível com as assinaturas" />
      </div>

      <Card><CardContent className="space-y-2 pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Receita por plano</h2>
        {o.by_plan.map((x) => (
          <div key={x.plan} className="flex items-center gap-3 text-sm">
            <span className="w-40 shrink-0 truncate">{x.plan}</span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-secondary"><div className="h-full bg-primary" style={{ width: `${(x.mrr_cents / maxMrr) * 100}%` }} /></div>
            <span className="w-28 shrink-0 text-right tabular-nums">{formatBRL(x.mrr_cents / 100)} · {x.orgs} grupo(s)</span>
          </div>
        ))}
      </CardContent></Card>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold uppercase tracking-wide text-primary">Grupos ({shown.length})</h2>
        <Input aria-label="Buscar grupo" className="h-8 w-48" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <NativeSelect aria-label="Situação" className="h-8" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todas as situações</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
      </div>
      <Card className="overflow-x-auto py-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="pl-4">Grupo</TableHead><TableHead>Situação</TableHead><TableHead>Plano</TableHead><TableHead className="text-center">Atletas</TableHead>
            <TableHead className="text-center">Admins</TableHead><TableHead className="text-center">Jogos</TableHead><TableHead>Criado</TableHead><TableHead>Teste até</TableHead><TableHead>Atividade</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {shown.map((g) => {
              const full = g.athletes_limit != null && g.athletes >= g.athletes_limit
              return (
                <TableRow key={g.id}>
                  <TableCell className="pl-4"><div className="font-medium">{g.name}</div><div className="text-xs text-muted-foreground">{g.slug}{g.notes ? ` · ${g.notes}` : ""}</div></TableCell>
                  <TableCell>{STATUS[g.status] ?? g.status}{g.status_reason && <div className="text-xs text-muted-foreground">{g.status_reason}</div>}</TableCell>
                  <TableCell>
                    <NativeSelect aria-label={`Plano de ${g.name}`} className="h-7 text-xs" value={g.plan_code} disabled={busy}
                      onChange={(e) => act(() => db().rpc("sa_set_org_plan", { p_org: g.id, p_plan: e.target.value }), "Plano alterado.")}>
                      {plans.filter((p) => p.active || p.code === g.plan_code).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                    </NativeSelect>
                  </TableCell>
                  <TableCell className={`text-center tabular-nums ${full ? "font-semibold text-destructive" : ""}`}>{g.athletes}{g.athletes_limit != null ? ` / ${g.athletes_limit}` : ""}</TableCell>
                  <TableCell className="text-center tabular-nums">{g.admins}</TableCell>
                  <TableCell className="text-center tabular-nums">{g.matches}</TableCell>
                  <TableCell className="whitespace-nowrap">{dt(g.created_at)}</TableCell>
                  <TableCell className="whitespace-nowrap">{g.status === "teste" ? dt(g.trial_ends_at) : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{dt(g.last_activity)}</TableCell>
                  <TableCell><div className="flex flex-wrap justify-end gap-1 pr-2">
                    {g.status === "suspensa" || g.status === "cancelada"
                      ? <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => db().rpc("sa_set_org_status", { p_org: g.id, p_status: "ativa", p_reason: null }), "Grupo reativado.")}>Reativar</Button>
                      : <Button size="sm" variant="outline" disabled={busy} onClick={() => { const r = window.prompt(`Suspender “${g.name}”? O grupo perde o acesso imediatamente. Motivo (opcional):`); if (r !== null) act(() => db().rpc("sa_set_org_status", { p_org: g.id, p_status: "suspensa", p_reason: r }), "Grupo suspenso.") }}>Suspender</Button>}
                    {g.status === "teste" && <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => db().rpc("sa_extend_trial", { p_org: g.id, p_days: 7 }), "Teste estendido em 7 dias.")}>+7 dias</Button>}
                    {g.status === "teste" && <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => db().rpc("sa_set_org_status", { p_org: g.id, p_status: "ativa", p_reason: null }), "Grupo ativado.")}>Ativar</Button>}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const n = window.prompt("Anotação interna (só você vê):", g.notes ?? ""); if (n !== null) act(() => db().rpc("sa_set_notes", { p_org: g.id, p_notes: n }), "Anotação salva.") }}>Nota</Button>
                  </div></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      <Card><CardContent className="space-y-3 pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Novo grupo</h2>
        <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); act(async () => {
          const r = await db().rpc("sa_create_org", { p_slug: nw.slug, p_name: nw.name, p_plan: nw.plan })
          if (r.error || !nw.email.trim()) return r
          return db().rpc("sa_assign_admin", { p_org: r.data as string, p_email: nw.email.trim() })
        }, "Grupo criado.").then(() => setNw({ name: "", slug: "", plan: "teste", email: "" })) }}>
          <div className="space-y-1.5"><Label htmlFor="nn">Nome</Label><Input id="nn" required maxLength={80} value={nw.name} onChange={(e) => setNw((x) => ({ ...x, name: e.target.value, slug: slugify(e.target.value) }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="ns">Endereço</Label><Input id="ns" required maxLength={40} value={nw.slug} onChange={(e) => setNw((x) => ({ ...x, slug: slugify(e.target.value) }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="np">Plano</Label>
            <NativeSelect id="np" className="w-full" value={nw.plan} onChange={(e) => setNw((x) => ({ ...x, plan: e.target.value }))}>{plans.filter((p) => p.active).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="ne">E-mail do administrador <span className="font-normal text-muted-foreground">(conta já cadastrada)</span></Label><Input id="ne" type="email" value={nw.email} onChange={(e) => setNw((x) => ({ ...x, email: e.target.value }))} /></div>
          <div className="sm:col-span-4"><Button type="submit" variant="brand" disabled={busy}>Criar grupo</Button></div>
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
    <div className="grid items-center gap-2 sm:grid-cols-[8rem_1fr_7rem_7rem_auto_auto]">
      {isNew ? <Input aria-label="Código do novo plano" placeholder="código" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /> : <span className="text-xs text-muted-foreground">{p.code} · {p.orgs} grupo(s)</span>}
      <Input aria-label="Nome do plano" placeholder="Nome" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <Input aria-label="Preço mensal (R$)" inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} />
      <Input aria-label="Limite de atletas" inputMode="numeric" placeholder="ilimitado" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} />
      <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Ativo</label>
      <Button size="sm" variant="outline" disabled={busy || !v.name.trim()} onClick={save}>{isNew ? "Criar" : "Salvar"}</Button>
    </div>
  )
}
