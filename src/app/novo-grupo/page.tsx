"use client"

import { SetupNotice } from "@/components/setup-notice"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import { orgAddress, slugify } from "@/lib/tenant"
import { Loader2, MailCheck } from "lucide-react"
import Link from "next/link"
import * as React from "react"

type Avail = "idle" | "checking" | "ok" | "taken"

/** Cria um grupo novo: quem se cadastra vira a Diretoria. O grupo nasce em teste de 14 dias, depois da confirmação do e-mail. */
export default function NewGroupPage() {
  const [f, setF] = React.useState({ grupo: "", slug: "", nome: "", email: "", senha: "", senha2: "", site: "" })
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [avail, setAvail] = React.useState<Avail>("idle")
  const [terms, setTerms] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const [sent, setSent] = React.useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }))

  React.useEffect(() => { if (!slugTouched) setF((x) => ({ ...x, slug: slugify(x.grupo) })) }, [f.grupo, slugTouched])
  React.useEffect(() => {
    if (!supabaseConfigured || f.slug.length < 3) { setAvail("idle"); return }
    setAvail("checking")
    let alive = true
    const t = setTimeout(() => {
      supabase().rpc("slug_available", { p_slug: f.slug }).then((r) => alive && setAvail(r.data === true ? "ok" : "taken"))
    }, 350)
    return () => { alive = false; clearTimeout(t) }
  }, [f.slug])

  if (!supabaseConfigured) return <SetupNotice />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    const nome = f.nome.trim().replace(/\s+/g, " "), grupo = f.grupo.trim().replace(/\s+/g, " "), email = f.email.trim().toLowerCase()
    if (grupo.length < 3) return setError("Informe o nome do grupo.")
    if (avail !== "ok") return setError("Escolha um endereço disponível para o grupo.")
    if (nome.length < 3) return setError("Informe o seu nome completo.")
    if (f.senha.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.")
    if (f.senha !== f.senha2) return setError("As senhas não conferem.")
    if (!terms) return setError("É preciso aceitar os termos para continuar.")
    if (f.site) { setSent(email); return }   // campo-isca de robôs
    setBusy(true)
    const { error: err } = await supabase().auth.signUp({
      email, password: f.senha,
      options: { data: { full_name: nome, new_org_name: grupo, new_org_slug: f.slug } },
    })
    setBusy(false)
    if (err) {
      const m = err.message.toLowerCase()
      if (m.includes("rate limit") || err.status === 429) return setError("Muitas tentativas. Aguarde alguns minutos e tente de novo.")
      if (m.includes("password")) return setError("Senha fraca. Use 8 ou mais caracteres, misturando letras e números.")
      if (m.includes("signups not allowed")) return setError("O cadastro de novos grupos está fechado no momento.")
      return setError("Não foi possível criar o grupo. Confira os dados e tente novamente.")
    }
    setSent(email)
  }

  const address = orgAddress(f.slug || "seu-grupo")
  return (
    <div className="grid min-h-dvh place-items-center bg-[#1C3D63] p-4">
      <div className="w-full max-w-lg space-y-5 rounded-xl bg-card p-6 shadow-xl">
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-wide uppercase">Criar meu grupo</h1>
          <p className="text-sm text-muted-foreground">Mensalidades, jogos, escalações e artilharia do seu grupo de futebol</p>
        </div>
        {sent ? (
          <div className="space-y-3 text-center">
            <MailCheck className="mx-auto size-10 text-primary" aria-hidden />
            <h2 className="text-lg font-semibold">Confirme o seu e-mail</h2>
            <p className="text-sm text-muted-foreground">Enviamos um link para <b>{sent}</b>. Depois de confirmar, entre com a sua senha: o grupo já estará criado, com 14 dias de teste.</p>
            <Link href="/login" className="text-sm underline">Ir para o login</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3.5">
            <div className="space-y-1.5"><Label htmlFor="g">Nome do grupo</Label>
              <Input id="g" required maxLength={80} placeholder="Ex.: Futebol dos Amigos" value={f.grupo} onChange={set("grupo")} /></div>
            <div className="space-y-1.5"><Label htmlFor="s">Endereço do grupo</Label>
              <Input id="s" required maxLength={40} value={f.slug} onChange={(e) => { setSlugTouched(true); setF((x) => ({ ...x, slug: slugify(e.target.value) })) }} />
              <p className={`text-xs ${avail === "taken" ? "text-destructive" : "text-muted-foreground"}`}>
                {avail === "checking" ? "Verificando…" : avail === "ok" ? `Disponível${address ? `: ${address}` : ""}` : avail === "taken" ? "Indisponível: escolha outro endereço." : "Use letras, números e hífen (mínimo de 3 caracteres)."}
              </p></div>
            <div className="space-y-1.5"><Label htmlFor="n">Seu nome completo</Label>
              <Input id="n" autoComplete="name" required maxLength={120} value={f.nome} onChange={set("nome")} /></div>
            <div className="space-y-1.5"><Label htmlFor="e">E-mail</Label>
              <Input id="e" type="email" autoComplete="email" required value={f.email} onChange={set("email")} /></div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="p1">Senha</Label><Input id="p1" type="password" autoComplete="new-password" required minLength={8} value={f.senha} onChange={set("senha")} /></div>
              <div className="space-y-1.5"><Label htmlFor="p2">Repita a senha</Label><Input id="p2" type="password" autoComplete="new-password" required minLength={8} value={f.senha2} onChange={set("senha2")} /></div>
            </div>
            <div aria-hidden className="absolute -left-[9999px]"><label>Site<input tabIndex={-1} autoComplete="off" value={f.site} onChange={set("site")} /></label></div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox checked={terms} onCheckedChange={(v) => setTerms(v === true)} className="mt-0.5" />
              <span>Concordo em guardar os dados do meu grupo (atletas, pagamentos e jogos) na plataforma, sob responsabilidade da Diretoria do grupo.</span>
            </label>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Criar grupo</Button>
            <p className="text-center text-sm text-muted-foreground">Já tem conta? <Link href="/login" className="underline">Entrar</Link></p>
          </form>
        )}
      </div>
    </div>
  )
}
