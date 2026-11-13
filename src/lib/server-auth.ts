import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

/** Cliente Supabase do servidor com a sessão de quem chamou (as regras de acesso do banco continuam valendo). */
/** Slug do grupo dono do servidor: só ele usa as credenciais globais (Pix BTG/OpenPix, WhatsApp, e-mail) até existir credencial por grupo. */
export const platformOrgSlug = () => (process.env.PLATFORM_ORG_SLUG || "geab").toLowerCase()

/** O usuário logado pertence ao grupo dono do servidor? (as regras de acesso devolvem só a organização dele) */
export async function isOwnerOrg(sb: Awaited<ReturnType<typeof adminClient>>) {
  if (!sb) return false
  const { data } = await sb.from("organizations").select("slug").maybeSingle()
  return data?.slug === platformOrgSlug()
}

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

/** Usuário logado (qualquer nível), sem checar perfil: serve à assinatura, que precisa funcionar com o grupo bloqueado. */
export async function sessionUser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  const jar = await cookies()
  const sb = createServerClient(url, key, { cookies: { getAll: () => jar.getAll(), setAll: () => {} } })
  const { data: { user } } = await sb.auth.getUser()
  return user
}

/** O plano do grupo inclui este módulo? (a regra é do banco: my_modules vem do plano da organização do usuário) */
export async function moduleEnabled(sb: NonNullable<Awaited<ReturnType<typeof adminClient>>>, mod: "importar" | "ao_vivo" | "pix" | "mensagens") {
  const { data } = await sb.rpc("my_modules")
  return Array.isArray(data) && data.includes(mod)
}
export const MODULE_OFF = { error: "Este recurso não está incluído no plano do grupo. Fale com o suporte." }
