"use client"

import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import { clientSlug } from "@/lib/tenant"
import * as React from "react"

export type Org = { slug: string; name: string; logo_url: string | null; primary_color: string | null; website: string | null; tagline: string | null; card_footer?: string | null }
export type MyOrg = Org & { id: string; status: string; trial_ends_at: string | null }

export const ORG_CHANGED = "geab:org"

/** Identidade pública do grupo (login e cadastro, antes de entrar). O slug vem do endereço; sem ele, a única organização. */
export function usePublicOrg(slug?: string | null) {
  const [org, setOrg] = React.useState<Org | null>(null)
  const [loading, setLoading] = React.useState(true)
  React.useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return }
    let alive = true
    supabase().rpc("org_public", { p_slug: slug ?? clientSlug() }).then((r) => {
      if (!alive) return
      setOrg(((r.data ?? []) as Org[])[0] ?? null)
      setLoading(false)
    })
    return () => { alive = false }
  }, [slug])
  return { org, loading }
}

/** Grupo do usuário logado (as regras de acesso só devolvem o próprio). */
export function useOrg() {
  const [org, setOrg] = React.useState<MyOrg | null>(null)
  const load = React.useCallback(() => {
    if (!supabaseConfigured) return
    supabase().from("organizations").select("id, slug, name, logo_url, primary_color, website, tagline, card_footer, status, trial_ends_at").maybeSingle()
      .then((r) => setOrg((r.data as MyOrg | null) ?? null), () => {})
  }, [])
  React.useEffect(() => {
    load()
    window.addEventListener(ORG_CHANGED, load)
    return () => window.removeEventListener(ORG_CHANGED, load)
  }, [load])
  return org
}
