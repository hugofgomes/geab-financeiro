"use client"

import { NameCard, PasswordCard } from "@/components/account-cards"
import { SetupNotice } from "@/components/setup-notice"
import { useLoad } from "@/hooks/use-load"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"

export default function MyAccountPage() {
  const { data, reload } = useLoad(async () => {
    const sb = supabase()
    const { data: u } = await sb.auth.getUser()
    const p = await sb.from("profiles").select("full_name, role").eq("id", u.user?.id ?? "").maybeSingle()
    return { email: u.user?.email ?? "", name: (p.data?.full_name as string | undefined) ?? "" }
  }, [])
  if (!supabaseConfigured) return <SetupNotice />
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Minha conta</h1>
        <p className="text-sm text-muted-foreground">Perfil: <strong>Diretoria</strong>{data?.email && <> · {data.email}</>}</p>
      </div>
      {data && <NameCard fullName={data.name} withNickname={false} onSaved={reload} />}
      <PasswordCard />
    </div>
  )
}
