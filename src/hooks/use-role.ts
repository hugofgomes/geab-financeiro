"use client"

import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Role } from "@/lib/roles"
import * as React from "react"

/** Nível de acesso do usuário logado. `canWrite` só para administrador. */
export function useRole() {
  const [role, setRole] = React.useState<Role | null>(null)
  React.useEffect(() => {
    if (!supabaseConfigured) return
    const sb = supabase()
    sb.auth.getUser().then(({ data }) => {
      if (!data.user) return
      return sb.from("profiles").select("role").eq("id", data.user.id).maybeSingle().then((r) => setRole((r.data?.role as Role | undefined) ?? null))
    }).catch(() => {})
  }, [])
  return { role, canWrite: role === "admin" }
}
