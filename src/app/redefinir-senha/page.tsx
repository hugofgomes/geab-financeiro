"use client"

import { OrgHeading } from "@/components/org-heading"
import { SetupNotice } from "@/components/setup-notice"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePublicOrg } from "@/hooks/use-org"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import * as React from "react"

export default function ResetPasswordPage() {
  const { org } = usePublicOrg()
  const [hasSession, setHasSession] = React.useState<boolean | null>(null)
  const [pw, setPw] = React.useState("")
  const [pw2, setPw2] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  React.useEffect(() => { if (supabaseConfigured) supabase().auth.getUser().then((r) => setHasSession(!!r.data.user), () => setHasSession(false)) }, [])
  if (!supabaseConfigured) return <SetupNotice />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (pw.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.")
    if (pw !== pw2) return setError("As senhas não conferem.")
    setBusy(true)
    const { error: err } = await supabase().auth.updateUser({ password: pw })
    if (err) {
      setBusy(false)
      const m = err.message.toLowerCase()
      return setError(m.includes("different") ? "A nova senha deve ser diferente da atual." : m.includes("password") ? "Senha fraca. Use 8 ou mais caracteres, misturando letras e números." : "Não foi possível alterar a senha. Peça um novo link.")
    }
    window.location.href = "/"
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-[#1E3A5F] p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl bg-card p-6 shadow-xl">
        <OrgHeading org={org} subtitle="Nova senha" />
        {hasSession === null ? <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" /> : !hasSession ? (
          <div className="space-y-3 text-center">
            <p className="text-sm">Este link venceu ou já foi usado. Peça um novo para continuar.</p>
            <Link href="/recuperar" className="text-sm underline">Pedir novo link</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="n1">Nova senha</Label><Input id="n1" type="password" autoComplete="new-password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="n2">Repita a nova senha</Label><Input id="n2" type="password" autoComplete="new-password" required minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar nova senha</Button>
          </form>
        )}
      </div>
    </div>
  )
}
