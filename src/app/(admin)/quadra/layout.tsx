"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { CourtRoleCtx, useCourtRole } from "@/hooks/use-court-role"
import { Lock } from "lucide-react"

/** Entrada do módulo: só entra quem tem perfil no módulo (e o plano precisa incluir Quadra Esportiva). O banco aplica a mesma regra. */
export default function QuadraLayout({ children }: { children: React.ReactNode }) {
  const role = useCourtRole()
  if (role === undefined) return <Skeleton className="h-60" />
  if (!role) {
    return (
      <div role="note" className="mx-auto mt-10 max-w-md space-y-3 rounded-2xl border bg-card p-6 text-center">
        <Lock className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">Módulo indisponível</h1>
        <p className="text-sm text-muted-foreground">O módulo Quadra Esportiva não está ativo no plano desta conta, ou o seu usuário ainda não tem perfil nele. Fale com o administrador ou com o suporte.</p>
      </div>
    )
  }
  return <CourtRoleCtx.Provider value={role}><div className="quadra-theme space-y-6">{children}</div></CourtRoleCtx.Provider>
}
