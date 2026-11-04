"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabase/client"
import { Loader2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

/** Edição do próprio nome (e apelido, quando houver). */
export function NameCard({ fullName, nickname, withNickname, onSaved }: { fullName: string; nickname?: string | null; withNickname: boolean; onSaved: () => void }) {
  const [name, setName] = React.useState(fullName)
  const [nick, setNick] = React.useState(nickname ?? "")
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { setName(fullName); setNick(nickname ?? "") }, [fullName, nickname])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase().rpc("update_my_profile", { p_full_name: name, p_nickname: withNickname ? nick : null })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Nome atualizado.")
    onSaved()
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Meu nome</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="mn">Nome completo</Label><Input id="mn" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} autoComplete="name" /></div>
          {withNickname && <div className="space-y-1.5"><Label htmlFor="mk">Apelido</Label><Input id="mk" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={60} /></div>}
          <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar nome</Button></div>
        </form>
      </CardContent>
    </Card>
  )
}

/** Troca de senha: confere a senha atual e só então grava a nova. */
export function PasswordCard() {
  const [cur, setCur] = React.useState("")
  const [pw, setPw] = React.useState("")
  const [pw2, setPw2] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return toast.error("A nova senha precisa ter pelo menos 8 caracteres.")
    if (pw !== pw2) return toast.error("As senhas novas não conferem.")
    if (pw === cur) return toast.error("A nova senha deve ser diferente da atual.")
    setBusy(true)
    const sb = supabase()
    const { data: u } = await sb.auth.getUser()
    const email = u.user?.email
    if (!email) { setBusy(false); return toast.error("Sessão expirada. Entre novamente.") }
    const check = await sb.auth.signInWithPassword({ email, password: cur })
    if (check.error) { setBusy(false); return toast.error("A senha atual está incorreta.") }
    const { error } = await sb.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) {
      const m = error.message.toLowerCase()
      return toast.error(m.includes("different") ? "A nova senha deve ser diferente da atual." : m.includes("password") ? "Senha fraca. Use 8 ou mais caracteres, misturando letras e números." : "Não foi possível alterar a senha.")
    }
    setCur(""); setPw(""); setPw2("")
    toast.success("Senha alterada.")
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Alterar senha</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5"><Label htmlFor="pc">Senha atual</Label><Input id="pc" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="pn">Nova senha</Label><Input id="pn" type="password" autoComplete="new-password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="pr">Repita a nova senha</Label><Input id="pr" type="password" autoComplete="new-password" required minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          <div className="sm:col-span-3"><Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Alterar senha</Button></div>
        </form>
      </CardContent>
    </Card>
  )
}
