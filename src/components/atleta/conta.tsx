"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabase/client"
import type { Athlete } from "@/lib/types"
import { cn } from "@/lib/utils"
import { normalizePhone } from "@/lib/whatsapp"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

export type EditMode = "pessoais" | "contatos" | "perfil"
const TITLE: Record<EditMode, string> = { pessoais: "Dados pessoais", contatos: "Contatos", perfil: "Editar perfil" }

/** Edição do próprio cadastro em janela: nome/apelido (update_my_profile) e telefone/e-mail (update_my_contact). */
export function EditDialog({ mode, athlete, onClose, onSaved }: { mode: EditMode | null; athlete: Athlete; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState("")
  const [nick, setNick] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (!mode) return
    setName(athlete.full_name); setNick(athlete.nickname ?? ""); setPhone(athlete.phone ? `+${athlete.phone}` : ""); setEmail(athlete.email ?? "")
  }, [mode, athlete])
  const personal = mode === "pessoais" || mode === "perfil"
  const contact = mode === "contatos" || mode === "perfil"

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const sb = supabase()
    if (personal) {
      const { error } = await sb.rpc("update_my_profile", { p_full_name: name, p_nickname: nick })
      if (error) { setBusy(false); return toast.error(`Não foi possível salvar: ${error.message}`) }
    }
    if (contact) {
      const { error } = await sb.rpc("update_my_contact", { p_phone: normalizePhone(phone), p_email: email.trim() || null })
      if (error) { setBusy(false); return toast.error(`Não foi possível salvar: ${error.message}`) }
    }
    setBusy(false)
    toast.success(mode === "contatos" ? "Contatos atualizados." : "Perfil atualizado com sucesso.")
    onSaved(); onClose()
  }

  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{mode ? TITLE[mode] : ""}</DialogTitle><DialogDescription>As alterações valem para o seu cadastro no grupo.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          {personal && <>
            <div className="space-y-1.5"><Label htmlFor="ed-n">Nome completo</Label><Input id="ed-n" className="h-11" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} autoComplete="name" /></div>
            <div className="space-y-1.5"><Label htmlFor="ed-k">Apelido</Label><Input id="ed-k" className="h-11" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={60} /></div>
          </>}
          {contact && <>
            <div className="space-y-1.5"><Label htmlFor="ed-p">Telefone (WhatsApp)</Label><Input id="ed-p" className="h-11" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="ed-e">E-mail</Label><Input id="ed-e" className="h-11" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          </>}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>Cancelar</Button>
            <Button type="submit" className="h-11" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Força da senha: comprimento e variedade de caracteres. */
export function passwordStrength(pw: string) {
  let n = 0
  if (pw.length >= 8) n++
  if (pw.length >= 12) n++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++
  if (/\d/.test(pw)) n++
  if (/[^A-Za-z0-9]/.test(pw)) n++
  const level = pw.length < 8 ? 0 : Math.min(3, Math.max(1, n - 1))
  return { level, label: ["Muito curta", "Fraca", "Média", "Forte"][level] }
}

function PasswordField({ id, label, value, onChange, show, autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; show: boolean; autoComplete: string }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} className="h-11" type={show ? "text" : "password"} autoComplete={autoComplete} required minLength={id === "pw-a" ? 1 : 8} value={value} onChange={(e) => onChange(e.target.value)} /></div>
}

/** Troca de senha: confere a senha atual e só então grava a nova (mesma regra de antes). */
export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cur, setCur] = React.useState("")
  const [pw, setPw] = React.useState("")
  const [pw2, setPw2] = React.useState("")
  const [show, setShow] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  React.useEffect(() => { if (open) { setCur(""); setPw(""); setPw2(""); setShow(false); setError("") } }, [open])
  const st = passwordStrength(pw)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (pw.length < 8) return setError("A nova senha precisa ter pelo menos 8 caracteres.")
    if (pw !== pw2) return setError("As senhas novas não conferem.")
    if (pw === cur) return setError("A nova senha deve ser diferente da atual.")
    setBusy(true)
    const sb = supabase()
    const { data: u } = await sb.auth.getUser()
    const email = u.user?.email
    if (!email) { setBusy(false); return setError("Sessão expirada. Entre novamente.") }
    const check = await sb.auth.signInWithPassword({ email, password: cur })
    if (check.error) { setBusy(false); return setError("A senha atual está incorreta.") }
    const { error: err } = await sb.auth.updateUser({ password: pw })
    setBusy(false)
    if (err) {
      const m = err.message.toLowerCase()
      return setError(m.includes("different") ? "A nova senha deve ser diferente da atual." : m.includes("password") ? "Senha fraca. Use 8 ou mais caracteres, misturando letras e números." : "Não foi possível alterar a senha.")
    }
    toast.success("Senha atualizada com sucesso.")
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Alterar senha</DialogTitle><DialogDescription>Informe a senha atual e escolha uma nova, com 8 ou mais caracteres.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          <PasswordField id="pw-a" label="Senha atual" value={cur} onChange={setCur} show={show} autoComplete="current-password" />
          <PasswordField id="pw-n" label="Nova senha" value={pw} onChange={setPw} show={show} autoComplete="new-password" />
          {pw && (
            <div aria-live="polite" className="space-y-1">
              <div className="flex gap-1" aria-hidden>{[1, 2, 3].map((i) => <span key={i} className={cn("h-1.5 flex-1 rounded-full", st.level >= i ? (st.level === 1 ? "bg-[#EF3028]" : st.level === 2 ? "bg-amber-500" : "bg-green-600") : "bg-slate-200")} />)}</div>
              <p className="text-xs text-muted-foreground">Força da senha: <b>{st.label}</b></p>
            </div>
          )}
          <PasswordField id="pw-r" label="Confirmar nova senha" value={pw2} onChange={setPw2} show={show} autoComplete="new-password" />
          <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} className="flex min-h-11 items-center gap-2 self-start rounded-lg text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {show ? "Ocultar senhas" : "Mostrar senhas"}
          </button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>Cancelar</Button>
            <Button type="submit" className="h-11" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Atualizar senha</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
