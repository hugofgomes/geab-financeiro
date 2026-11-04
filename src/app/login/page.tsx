"use client"

import { Logo } from "@/components/logo"
import { SetupNotice } from "@/components/setup-notice"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import * as React from "react"

function Form() {
  const params = useSearchParams()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(params.get("erro") === "link-invalido" ? "Link de confirmação inválido ou expirado. Faça login, ou cadastre-se de novo para receber outro e-mail." : "")

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError("")
    const { error } = await supabase().auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message.toLowerCase().includes("not confirmed") ? "Confirme seu e-mail pelo link que enviamos antes de entrar." : "E-mail ou senha inválidos.")
      setBusy(false)
      return
    }
    window.location.href = "/"
  }

  return (
    <form method="post" onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="senha">Senha</Label>
        <Input id="senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />} Entrar
      </Button>
      <p className="text-center text-sm text-muted-foreground">Primeiro acesso? <Link href="/cadastro" className="underline">Cadastre-se</Link></p>
    </form>
  )
}

export default function LoginPage() {
  if (!supabaseConfigured) return <SetupNotice />
  return (
    <div className="grid min-h-dvh place-items-center bg-[#0b3d1e] p-4">
      <div className="w-full max-w-sm space-y-6 rounded-2xl bg-background p-6 shadow-xl">
        <div className="text-center">
          <Logo size={96} className="mx-auto" />
          <h1 className="mt-2 text-xl font-semibold">GEAB Futebol</h1>
          <p className="text-sm text-muted-foreground">Financeiro · desde 1998</p>
        </div>
        <React.Suspense>
          <Form />
        </React.Suspense>
      </div>
    </div>
  )
}
