"use client"

import { supabase } from "@/lib/supabase/client"
import { Eye } from "lucide-react"
import * as React from "react"

/** Faixa fixa enquanto o dono da plataforma está no modo espião (suporte, somente leitura). */
export function SpyBanner() {
  const [s, setS] = React.useState<{ org_name: string; expires_at: string } | null>(null)
  React.useEffect(() => {
    supabase().rpc("my_support_session").then((r) => setS(((r.data as { org_name: string; expires_at: string }[] | null) ?? [])[0] ?? null), () => {})
  }, [])
  if (!s) return null
  async function leave() { await supabase().rpc("sa_support_stop"); window.location.href = "/super" }
  return (
    <div role="status" className="sticky top-2 z-40 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400 bg-amber-100 px-3 py-2 text-sm text-amber-950 shadow">
      <span className="flex items-center gap-2"><Eye className="size-4 shrink-0" aria-hidden /><b>Modo espião</b> · {s.org_name} · somente leitura · até {new Date(s.expires_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
      <button type="button" onClick={leave} className="rounded-md bg-amber-900 px-3 py-1 text-xs font-medium text-white hover:bg-amber-950">Sair do modo espião</button>
    </div>
  )
}
