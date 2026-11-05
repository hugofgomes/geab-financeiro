import { createClient } from "@supabase/supabase-js"

/** Cliente com a chave de serviço: SÓ para rotas do servidor que não têm usuário logado (webhooks). Nunca importar no navegador. */
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
