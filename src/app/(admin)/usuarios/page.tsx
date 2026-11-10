"use client"

import { NativeSelect } from "@/components/native-select"
import { SetupNotice } from "@/components/setup-notice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLoad } from "@/hooks/use-load"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import { Loader2, Pencil, UserX } from "lucide-react"
import { ptCompare } from "@/lib/format"
import * as React from "react"
import { toast } from "sonner"

type UserRow = { id: string; full_name: string; email: string; role: "admin" | "diretoria" | "atleta"; active: boolean; athlete_id: string | null; athlete_name: string | null; created_at: string; last_sign_in_at: string | null }
type AthleteOpt = { id: string; full_name: string }

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "nunca")

function EditDialog({ user, me, free, onClose, onSaved }: { user: UserRow | null; me: string; free: AthleteOpt[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState("")
  const [role, setRole] = React.useState<"admin" | "diretoria" | "atleta">("atleta")
  const [active, setActive] = React.useState(true)
  const [athlete, setAthlete] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (user) { setName(user.full_name); setRole(user.role); setActive(user.active); setAthlete(user.athlete_id ?? "") }
  }, [user])
  if (!user) return null
  const isMe = user.id === me
  const options = [...(user.athlete_id && user.athlete_name ? [{ id: user.athlete_id, full_name: user.athlete_name }] : []), ...free]

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase().rpc("admin_update_user", { p_user: user!.id, p_full_name: name, p_role: role, p_active: active, p_athlete: role === "atleta" ? athlete || null : null })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Usuário atualizado.")
    onSaved(); onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Editar usuário</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <p className="text-sm text-muted-foreground">{user.email}</p>
          <div className="space-y-1.5"><Label htmlFor="un">Nome completo</Label><Input id="un" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="ur">Perfil de acesso</Label>
            <NativeSelect id="ur" className="w-full" value={role} onChange={(e) => setRole(e.target.value as "admin" | "diretoria" | "atleta")} disabled={isMe}>
              <option value="atleta">Atleta — vê só a própria conta</option>
              <option value="diretoria">Diretoria — consulta tudo, sem a administração</option>
              <option value="admin">Administrador — vê e gerencia tudo</option>
            </NativeSelect>
          </div>
          {role === "atleta" && (
            <div className="space-y-1.5">
              <Label htmlFor="ua">Atleta vinculado</Label>
              <NativeSelect id="ua" className="w-full" value={athlete} onChange={(e) => setAthlete(e.target.value)} required>
                <option value="">Selecione…</option>
                {options.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </NativeSelect>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} disabled={isMe} /> Acesso ativo</label>
          {isMe && <p className="text-xs text-muted-foreground">Você não pode alterar o seu próprio perfil de acesso nem se desativar.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function UsersPage() {
  const { data, error, loading, reload } = useLoad(async () => {
    const sb = supabase()
    const [u, a, me] = await Promise.all([sb.rpc("admin_users"), sb.from("athletes").select("id, full_name").order("full_name"), sb.auth.getUser()])
    if (u.error) throw new Error(u.error.message)
    if (a.error) throw new Error(a.error.message)
    const users = u.data as UserRow[]
    const linked = new Set(users.map((x) => x.athlete_id).filter(Boolean))
    return { users, free: (a.data as AthleteOpt[]).filter((x) => !linked.has(x.id)).sort((x, y) => ptCompare(x.full_name, y.full_name)), me: me.data.user?.id ?? "" }
  }, [])
  const [editing, setEditing] = React.useState<UserRow | null>(null)
  if (!supabaseConfigured) return <SetupNotice />

  async function remove(u: UserRow) {
    if (!window.confirm(`Remover o acesso de ${u.full_name}? O cadastro e os pagamentos do atleta continuam guardados.`)) return
    const { error } = await supabase().rpc("admin_remove_access", { p_user: u.id })
    if (error) return toast.error(error.message)
    toast.success("Acesso removido.")
    reload()
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usuários e privilégios</h1>
        <p className="text-sm text-muted-foreground">
          <strong>Administrador</strong> vê e gerencia tudo. <strong>Diretoria</strong> consulta todas as áreas, mas não altera nada nem acessa usuários, importação e configurações do grupo. <strong>Atleta</strong> vê apenas a própria conta e pode editar o próprio nome e a senha.
          Novas pessoas entram pelo formulário <code>/cadastro</code> e são liberadas em <strong>Cadastros</strong>.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>}
      {loading && !data ? <Skeleton className="h-48" /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Perfil</TableHead><TableHead>Atleta vinculado</TableHead><TableHead>Último acesso</TableHead><TableHead>Situação</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
            <TableBody>
              {(data?.users ?? []).map((u) => (
                <TableRow key={u.id}>
                  <TableCell><div className="font-medium">{u.full_name}{u.id === data?.me && <span className="ml-1 text-xs font-normal text-muted-foreground">(você)</span>}</div><div className="text-xs text-muted-foreground">{u.email}</div></TableCell>
                  <TableCell><Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role === "admin" ? "Administrador" : u.role === "diretoria" ? "Diretoria" : "Atleta"}</Badge></TableCell>
                  <TableCell className="text-sm">{u.athlete_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{fmt(u.last_sign_in_at)}</TableCell>
                  <TableCell><Badge variant={u.active ? "outline" : "destructive"}>{u.active ? "Ativo" : "Inativo"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" aria-label={`Editar ${u.full_name}`} onClick={() => setEditing(u)}><Pencil /></Button>
                      {u.id !== data?.me && <Button size="icon" variant="ghost" aria-label={`Remover acesso de ${u.full_name}`} onClick={() => remove(u)}><UserX /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <EditDialog user={editing} me={data?.me ?? ""} free={data?.free ?? []} onClose={() => setEditing(null)} onSaved={reload} />
    </>
  )
}
