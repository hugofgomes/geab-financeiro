import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

/** Cliente Supabase do servidor com a sessão de quem chamou (as regras de acesso do banco continuam valendo). */
export async function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  const jar = await cookies()
  const sb = createServerClient(url, key, { cookies: { getAll: () => jar.getAll(), setAll: () => {} } })
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data: p } = await sb.from("profiles").select("role, active").eq("id", user.id).maybeSingle()
  return p?.role === "admin" && p.active === true ? sb : null
}
