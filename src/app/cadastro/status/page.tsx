"use client"

import { SetupNotice } from "@/components/setup-notice"
import { OrgHeading } from "@/components/org-heading"
import { usePublicOrg } from "@/hooks/use-org"
import { Button } from "@/components/ui/button"
import { useLoad } from "@/hooks/use-load"
import { formatDate } from "@/lib/format"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import { slugify } from "@/lib/tenant"
import type { SignupRequest } from "@/lib/types"
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { useSearchParams } from "next/navigation"
import * as React from "react"

/** Conta confirmada que ainda não pertence a nenhum grupo: a própria pessoa escolhe criar o grupo (teste grátis) ou pedir entrada num grupo. */
function NoGroup() {
  const [mode, setMode] = React.useState<"create" | "join" | null>(null)
  const [days, setDays] = React.useState(10)
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  React.useEffect(() => { supabase().rpc("public_trial_days").then((r) => { if (typeof r.data === "number") setDays(r.data) }) }, [])
  async function go(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true)
    const r = mode === "create" ? await supabase().rpc("create_my_org", { p_name: name, p_slug: slug }) : await supabase().rpc("request_join_group", { p_slug: slug })
    setBusy(false)
    if (r.error) return setError(r.error.message)
    toast.success(mode === "create" ? "Grupo criado!" : "Pedido enviado.")
    window.location.href = mode === "create" ? "/" : "/cadastro/status"
  }
  return (
    <div className="space-y-4 text-left">
      <div className="space-y-1 text-center">
        <Clock className="mx-auto size-10 text-amber-600" aria-hidden />
        <h2 className="text-lg font-semibold">Falta escolher o seu grupo</h2>
        <p className="text-sm text-muted-foreground">Seu cadastro está confirmado, mas ainda não está ligado a nenhum grupo. Escolha como quer continuar:</p>
      </div>
      {!mode && (
        <div className="grid gap-2">
          <Button className="h-auto min-h-12 flex-col gap-0.5 py-2" onClick={() => setMode("create")}><span>Criar o meu grupo</span><span className="text-xs font-normal opacity-80">{days} dias grátis para testar</span></Button>
          <Button variant="outline" className="h-auto min-h-12 flex-col gap-0.5 py-2" onClick={() => setMode("join")}><span>Entrar em um grupo que já existe</span><span className="text-xs font-normal text-muted-foreground">a administração do grupo aprova o seu acesso</span></Button>
        </div>
      )}
      {mode && (
        <form onSubmit={go} className="space-y-3">
          {mode === "create" && <div className="space-y-1.5"><Label htmlFor="g-n">Nome do grupo</Label><Input id="g-n" required minLength={3} maxLength={80} value={name} onChange={(e) => { setName(e.target.value); setSlug(slugify(e.target.value)) }} /></div>}
          <div className="space-y-1.5">
            <Label htmlFor="g-s">{mode === "create" ? "Endereço do grupo" : "Endereço do grupo (peça à administração)"}</Label>
            <Input id="g-s" required maxLength={40} placeholder="ex.: pelada-da-quarta" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={() => { setMode(null); setError("") }}>Voltar</Button>
            <Button type="submit" className="h-11 flex-1" disabled={busy}>{busy && <Loader2 className="animate-spin" />} {mode === "create" ? `Criar grupo e começar o teste` : "Pedir entrada"}</Button>
          </div>
        </form>
      )}
    </div>
  )
}

function Content() {
  const confirmed = useSearchParams().get("confirmado") === "1"
  const { data, loading, reload } = useLoad(async () => {
    const r = await supabase().from("signup_requests").select("*").maybeSingle()
    if (r.error) throw new Error(r.error.message)
    return r.data as SignupRequest | null
  }, [])
  React.useEffect(() => { if (data?.status === "aprovado") window.location.href = "/" }, [data])
  const signOut = async () => {
    await supabase().auth.signOut()
    window.location.href = "/login"
  }
  return (
    <div className="space-y-4 text-center">
      {loading && !data ? <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" /> : data?.status === "recusado" ? (
        <>
          <XCircle className="mx-auto size-10 text-destructive" aria-hidden />
          <h2 className="text-lg font-semibold">Cadastro não aprovado</h2>
          <p className="text-sm text-muted-foreground">A administração do GEAB não liberou este acesso. Em caso de dúvida, fale com a diretoria.</p>
        </>
      ) : data ? (
        <>
          {confirmed ? <CheckCircle2 className="mx-auto size-10 text-green-600" aria-hidden /> : <Clock className="mx-auto size-10 text-amber-600" aria-hidden />}
          <h2 className="text-lg font-semibold">{confirmed ? "E-mail confirmado!" : "Cadastro recebido"}</h2>
          <p className="text-sm text-muted-foreground">
            Recebemos o cadastro de <strong className="text-foreground">{data.full_name}</strong> em {formatDate(data.created_at.slice(0, 10))}.
            Agora é só aguardar: a administração do grupo vai aprovar o seu acesso.
          </p>
          <Button variant="outline" onClick={reload} disabled={loading}>Verificar aprovação</Button>
        </>
      ) : (
<NoGroup />
      )}
      <div><Button variant="ghost" size="sm" onClick={signOut}>Sair</Button></div>
    </div>
  )
}

export default function SignupStatusPage() {
  const { org } = usePublicOrg()
  if (!supabaseConfigured) return <SetupNotice />
  return (
    <div className="grid min-h-dvh place-items-center bg-[#1E3A5F] p-4">
      <div className="w-full max-w-md space-y-5 rounded-xl bg-card p-6 shadow-xl">
        <OrgHeading org={org} subtitle="" />
        <React.Suspense><Content /></React.Suspense>
      </div>
    </div>
  )
}
