"use client"

import { OrgHeading } from "@/components/org-heading"
import { SetupNotice } from "@/components/setup-notice"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePublicOrg } from "@/hooks/use-org"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import { Loader2, MailCheck } from "lucide-react"
import Link from "next/link"
import * as React from "react"

export default function RecoverPage() {
  const { org } = usePublicOrg()
  const [email, setEmail] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const [error, setError] = React.useState("")
  if (!supabaseConfigured) return <SetupNotice />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError("")
    const { error: err } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/confirmar` })
    setBusy(false)
    // Por segurança a resposta é a mesma exista ou não a conta; só avisamos de limite de envios e falhas do servidor.
    if (err && (err.status === 429 || /rate limit/i.test(err.message))) return setError("Muitas tentativas. Aguarde alguns minutos e tente de novo.")
    if (err && (err.status ?? 0) >= 500) return setError("Não foi possível enviar o e-mail agora. Tente de novo em alguns minutos ou fale com a administração.")
    setSent(true)
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-[#1E3A5F] p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl bg-card p-6 shadow-xl">
        <OrgHeading org={org} subtitle="Recuperar senha" />
        {sent ? (
          <div className="space-y-3 text-center">
            <MailCheck className="mx-auto size-10 text-green-600" aria-hidden />
            <p className="text-sm">Se <strong>{email}</strong> tiver cadastro, enviamos um link para criar uma nova senha. Confira também a caixa de spam.</p>
            <Link href="/login" className="text-sm underline">Voltar ao login</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted-foreground">Informe o e-mail do seu cadastro. Enviaremos um link para você criar uma nova senha.</p>
            <div className="space-y-1.5"><Label htmlFor="em">E-mail</Label><Input id="em" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Enviar link</Button>
            <p className="text-center text-sm"><Link href="/login" className="text-muted-foreground underline">Voltar ao login</Link></p>
          </form>
        )}
      </div>
    </div>
  )
}
