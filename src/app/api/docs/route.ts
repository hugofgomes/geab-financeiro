import docs from "@/data/docs.generated.json"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

/** Documentação do sistema: só para o dono da plataforma. A sessão é validada e a permissão confirmada no banco antes de devolver qualquer conteúdo. */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const deny = () => NextResponse.json({ error: "Acesso restrito ao dono da plataforma." }, { status: 403, headers: { "Cache-Control": "no-store" } })
  if (!url || !key) return deny()
  const jar = await cookies()
  const sb = createServerClient(url, key, { cookies: { getAll: () => jar.getAll(), setAll: () => {} } })
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return deny()
  const { data } = await sb.rpc("is_platform_admin")
  if (data !== true) return deny()
  return NextResponse.json(docs, { headers: { "Cache-Control": "private, no-store" } })
}
