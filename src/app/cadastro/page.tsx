"use client"

import { SetupNotice } from "@/components/setup-notice"
import { OrgHeading } from "@/components/org-heading"
import { usePublicOrg } from "@/hooks/use-org"
import { clientSlug } from "@/lib/tenant"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import { normalizePhone } from "@/lib/whatsapp"
import { Loader2, MailCheck } from "lucide-react"
import Link from "next/link"
import * as React from "react"

const COOLDOWN = 60

/** Máscara (48) 99999-8888 enquanto digita; números com + (internacionais) ficam como digitados. */
function maskPhone(v: string) {
  if (v.trim().startsWith("+")) return v.replace(/[^\d+ ()-]/g, "").slice(0, 20)
  const d = v.replace(/\D/g, "").slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

function Shell({ children }: { children: React.ReactNode }) {
  const { org } = usePublicOrg()
  return (
    <div className="grid min-h-dvh place-items-center bg-[#1C3D63] p-4">
      <div className="w-full max-w-lg space-y-5 rounded-xl bg-card p-6 shadow-xl">
        <OrgHeading org={org} subtitle="Cadastro de atleta" />
        {children}
      </div>
    </div>
  )
}

function Sent({ email }: { email: string }) {
  const [left, setLeft] = React.useState(COOLDOWN)
  const [msg, setMsg] = React.useState("")
  React.useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  async function resend() {
    setMsg("")
    const { error } = await supabase().auth.resend({ type: "signup", email })
    if (error) return setMsg("Não foi possível reenviar agora. Tente novamente em alguns minutos.")
    setLeft(COOLDOWN)
    setMsg("E-mail reenviado.")
  }
  return (
    <Shell>
      <div className="space-y-3 text-center">
        <MailCheck className="mx-auto size-10 text-green-600" aria-hidden />
        <h2 className="text-lg font-semibold">Confira seu e-mail</h2>
        <p className="text-sm text-muted-foreground">
          Enviamos uma mensagem de confirmação para <strong className="text-foreground">{email}</strong>.
          Abra o e-mail e clique no link para confirmar o cadastro. Se não encontrar, olhe a caixa de spam.
        </p>
        <p className="text-sm text-muted-foreground">Depois da confirmação, a administração do grupo aprova o seu acesso.</p>
        <Button variant="outline" onClick={resend} disabled={left > 0}>
          {left > 0 ? `Reenviar e-mail em ${left}s` : "Reenviar e-mail"}
        </Button>
        {msg && <p role="status" className="text-sm text-muted-foreground">{msg}</p>}
        <p className="text-sm"><Link href="/login" className="underline">Ir para o login</Link></p>
      </div>
    </Shell>
  )
}

export default function SignupPage() {
  const [f, setF] = React.useState({ nome: "", apelido: "", nascimento: "", fone: "", email: "", senha: "", senha2: "", site: "" })
  const [wa, setWa] = React.useState(false)
  const [lgpd, setLgpd] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const [sent, setSent] = React.useState<string | null>(null)
  if (!supabaseConfigured) return <SetupNotice />
  if (sent) return <Sent email={sent} />
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    const nome = f.nome.trim().replace(/\s+/g, " ")
    const email = f.email.trim().toLowerCase()
    const fone = normalizePhone(f.fone)
    if (nome.length < 3 || !nome.includes(" ")) return setError("Informe seu nome completo.")
    const hoje = new Date().toISOString().slice(0, 10)
    if (!f.nascimento || f.nascimento > hoje || f.nascimento < "1900-01-01") return setError("Informe uma data de nascimento válida.")
    if (!fone || fone.length < 12 || fone.length > 15) return setError("Informe o WhatsApp com DDD, por exemplo (48) 99999-8888.")
    if (f.senha.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.")
    if (f.senha !== f.senha2) return setError("As senhas não conferem.")
    if (!lgpd) return setError("É preciso aceitar o uso dos dados para continuar.")
    if (f.site) { setSent(email); return }   // campo-isca preenchido por robôs: finge sucesso, não grava nada
    setBusy(true)
    const { error: err } = await supabase().auth.signUp({
      email,
      password: f.senha,
      options: { data: { signup_form: "true", full_name: nome, nickname: f.apelido.trim(), phone: fone, birth_date: f.nascimento, whatsapp_consent: String(wa), tenant_slug: clientSlug() ?? "" } },
    })
    setBusy(false)
    if (err) {
      const m = err.message.toLowerCase()
      if (m.includes("rate limit") || err.status === 429) return setError("Muitas tentativas. Aguarde alguns minutos e tente de novo.")
      if (m.includes("password")) return setError("Senha fraca. Use 8 ou mais caracteres, misturando letras e números.")
      if (m.includes("signups not allowed")) return setError("O cadastro está temporariamente fechado. Fale com a administração do grupo.")
      return setError("Não foi possível concluir o cadastro. Confira os dados e tente novamente.")
    }
    setSent(email)
  }

  return (
    <Shell>
      <form method="post" onSubmit={submit} className="space-y-3.5">
        <div className="space-y-1.5">
          <Label htmlFor="nome">Nome completo</Label>
          <Input id="nome" autoComplete="name" required maxLength={120} value={f.nome} onChange={set("nome")} />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="apelido">Apelido <span className="text-muted-foreground">(opcional)</span></Label>
            <Input id="apelido" maxLength={60} value={f.apelido} onChange={set("apelido")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nascimento">Data de nascimento</Label>
            <Input id="nascimento" type="date" required min="1900-01-01" max={new Date().toISOString().slice(0, 10)} autoComplete="bday" value={f.nascimento} onChange={set("nascimento")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fone">WhatsApp</Label>
            <Input id="fone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="(48) 99999-8888" value={f.fone} onChange={(e) => setF((x) => ({ ...x, fone: maskPhone(e.target.value) }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" required value={f.email} onChange={set("email")} />
          </div>
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="senha">Senha</Label>
            <Input id="senha" type="password" autoComplete="new-password" required minLength={8} value={f.senha} onChange={set("senha")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="senha2">Repita a senha</Label>
            <Input id="senha2" type="password" autoComplete="new-password" required minLength={8} value={f.senha2} onChange={set("senha2")} />
          </div>
        </div>
        {/* campo-isca anti-robô: invisível para pessoas */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>Site <input tabIndex={-1} autoComplete="off" value={f.site} onChange={set("site")} /></label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={wa} onCheckedChange={(v) => setWa(v === true)} className="mt-0.5" />
          <span>Aceito receber, pelo WhatsApp, a mensagem de agradecimento pelo pagamento da mensalidade.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={lgpd} onCheckedChange={(v) => setLgpd(v === true)} className="mt-0.5" />
          <span>Autorizo o grupo a guardar meus dados (nome, contato, data de nascimento e pagamentos) apenas para o controle das mensalidades.</span>
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Enviar cadastro
        </Button>
        <p className="text-center text-sm text-muted-foreground">Já tem acesso? <Link href="/login" className="underline">Entrar</Link></p>
      </form>
    </Shell>
  )
}
