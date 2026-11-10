"use client"

import { SetupNotice } from "@/components/setup-notice"
import { OrgHeading } from "@/components/org-heading"
import { usePublicOrg } from "@/hooks/use-org"
import { Button } from "@/components/ui/button"
import { useLoad } from "@/hooks/use-load"
import { formatDate } from "@/lib/format"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { SignupRequest } from "@/lib/types"
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react"
import { useSearchParams } from "next/navigation"
import * as React from "react"

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
        <>
          <Clock className="mx-auto size-10 text-amber-600" aria-hidden />
          <h2 className="text-lg font-semibold">Acesso ainda não liberado</h2>
          <p className="text-sm text-muted-foreground">Seu usuário existe, mas ainda não foi vinculado a um atleta. Fale com a administração do grupo.</p>
        </>
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
