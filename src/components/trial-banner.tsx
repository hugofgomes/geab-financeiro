"use client"

import { supabase } from "@/lib/supabase/client"
import Link from "next/link"
import * as React from "react"

/** Aviso para o administrador enquanto o grupo está no teste gratuito. */
export function TrialBanner() {
  const [days, setDays] = React.useState<number | null>(null)
  React.useEffect(() => {
    supabase().rpc("my_billing").then((r) => {
      const b = (r.data as { status: string; trial_days_left: number | null }[] | null)?.[0]
      if (b?.status === "teste" && b.trial_days_left != null) setDays(b.trial_days_left)
    })
  }, [])
  if (days == null) return null
  return (
    <p role="note" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span>{days <= 1 ? "Seu teste gratuito termina hoje." : `Seu teste gratuito termina em ${days} dias.`} Depois disso o acesso é bloqueado até a assinatura.</span>
      <Link href="/assinatura" className="rounded-md bg-amber-900 px-3 py-1 text-xs font-medium text-white">Assinar agora</Link>
    </p>
  )
}
