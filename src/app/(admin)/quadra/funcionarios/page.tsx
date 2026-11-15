"use client"

import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useCourtRoleCtx } from "@/hooks/use-court-role"
import { useLoad } from "@/hooks/use-load"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Loader2, Mail, Plus } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Staff = { profile_id: string; full_name: string; email: string; role: string; job_position: string | null; active: boolean; created_at: string; last_sign_in_at: string | null }
const ROLES: [string, string, string][] = [
  ["gerente", "Gerente", "Quadras, agenda, clientes, reservas e relatórios; cria bloqueios."],
  ["recepcionista", "Recepcionista", "Agenda, reservas, clientes e lista de espera."],
  ["financeiro", "Financeiro", "Consulta reservas e (na próxima fase) recebimentos e relatórios financeiros."],
]
const roleLabel = (r: string) => ROLES.find(([k]) => k === r)?.[1] ?? r

export default function FuncionariosPage() {
  const role = useCourtRoleCtx()!
  const { data, error, loading, reload } = useLoad<Staff[]>(async () => {
    if (role !== "admin") return []
    const r = await supabase().rpc("court_staff_list")
    if (r.error) throw new Error(r.error.message)
    return (r.data ?? []) as Staff[]
  }, [role])
  const [form, setForm] = React.useState<Staff | "novo" | null>(null)
  const [busy, setBusy] = React.useState("")
  if (role !== "admin") return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Somente o administrador do estabelecimento gerencia funcionários.</p>
  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading && !data) return <Skeleton className="h-60" />
  const list = data ?? []
  async function resend(s: Staff) {
    setBusy(s.profile_id)
    const r = await fetch("/api/quadra/funcionarios", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile_id: s.profile_id }) })
    setBusy(""); const j = await r.json().catch(() => ({}))
    if (r.ok) toast.success("E-mail de acesso enviado."); else toast.error(j.error ?? "Falha ao enviar.")
  }
  async function toggle(s: Staff) {
    if (s.active && !window.confirm(`Bloquear ${s.full_name}? A pessoa perde o acesso imediatamente (o histórico é mantido).`)) return
    setBusy(s.profile_id)
    const r = await supabase().rpc("court_staff_update", { p_profile: s.profile_id, p_role: s.role, p_position: s.job_position, p_active: !s.active })
    setBusy(""); if (r.error) toast.error(r.error.message); else { toast.success(s.active ? "Acesso bloqueado." : "Acesso reativado."); reload() }
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-xl font-semibold">Funcionários</h1><p className="text-sm text-muted-foreground">Cada pessoa tem login próprio e só acessa este estabelecimento. O convite chega por e-mail e a própria pessoa cria a senha.</p></div>
        <Button onClick={() => setForm("novo")}><Plus className="size-4" /> Convidar funcionário</Button>
      </div>
      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.profile_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
            <div className="min-w-0"><p className="font-semibold">{s.full_name} <span className={cn("ml-1 rounded-full px-2 py-0.5 text-xs font-medium", s.active ? "bg-green-100 text-green-900" : "bg-slate-200 text-slate-700")}>{s.active ? "Ativo" : "Bloqueado"}</span></p>
              <p className="truncate text-sm text-muted-foreground">{s.email} · {roleLabel(s.role)}{s.job_position && ` · ${s.job_position}`}</p>
              <p className="text-xs text-muted-foreground">{s.last_sign_in_at ? `Último acesso em ${new Date(s.last_sign_in_at).toLocaleDateString("pt-BR")}` : "Ainda não acessou (convite pendente)"}</p></div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" onClick={() => setForm(s)}>Editar</Button>
              {s.active && <Button size="sm" variant="outline" disabled={busy === s.profile_id} onClick={() => resend(s)}><Mail className="size-4" /> {s.last_sign_in_at ? "Redefinir senha" : "Reenviar convite"}</Button>}
              <Button size="sm" variant="outline" className={s.active ? "text-destructive" : ""} disabled={busy === s.profile_id} onClick={() => toggle(s)}>{s.active ? "Bloquear" : "Reativar"}</Button>
            </div>
          </li>
        ))}
        {list.length === 0 && <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum funcionário cadastrado. Você (administrador) já tem acesso total.</li>}
      </ul>
      <section className="rounded-xl border bg-card p-4 text-sm"><h2 className="font-semibold">Perfis</h2><ul className="mt-2 space-y-1 text-muted-foreground"><li><strong className="text-foreground">Administrador:</strong> tudo no estabelecimento, incluindo funcionários, financeiro e configurações.</li>{ROLES.map(([k, l, d]) => <li key={k}><strong className="text-foreground">{l}:</strong> {d}</li>)}</ul></section>
      <StaffForm key={form === "novo" ? "novo" : form?.profile_id ?? "x"} open={!!form} staff={form === "novo" ? null : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload() }} />
    </>
  )
}

function StaffForm({ open, staff, onClose, onSaved }: { open: boolean; staff: Staff | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = React.useState({ name: staff?.full_name ?? "", email: staff?.email ?? "", role: staff?.role ?? "recepcionista", position: staff?.job_position ?? "" })
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    if (staff) {
      const r = await supabase().rpc("court_staff_update", { p_profile: staff.profile_id, p_role: v.role, p_position: v.position, p_active: staff.active })
      setBusy(false); if (r.error) return toast.error(r.error.message)
      toast.success("Funcionário atualizado."); return onSaved()
    }
    const r = await fetch("/api/quadra/funcionarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) })
    setBusy(false); const j = await r.json().catch(() => ({}))
    if (!r.ok) return toast.error(j.error ?? "Falha ao convidar.")
    toast.success("Convite enviado por e-mail."); onSaved()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle>{staff ? "Editar funcionário" : "Convidar funcionário"}</DialogTitle><DialogDescription>{staff ? "Altere o perfil ou o cargo." : "A pessoa recebe um e-mail para criar a própria senha."}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="fn">Nome</Label><Input id="fn" required minLength={2} maxLength={120} disabled={!!staff} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="fe">E-mail</Label><Input id="fe" type="email" required disabled={!!staff} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="fr">Perfil</Label><NativeSelect id="fr" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="fc">Cargo</Label><Input id="fc" maxLength={60} value={v.position} onChange={(e) => setV({ ...v, position: e.target.value })} placeholder="Ex.: Recepção noturna" /></div>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} {staff ? "Salvar" : "Enviar convite"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
