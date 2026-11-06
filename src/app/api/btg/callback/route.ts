import { connectWithCode } from "@/lib/btg"
import { adminClient } from "@/lib/server-auth"
import { NextResponse } from "next/server"
import { btgRedirectUri, publicOrigin } from "@/lib/origin"

/** Volta do login do BTG: confere o `state` e a sessão da Diretoria, troca o código pelos tokens e guarda no servidor. */
export async function GET(req: Request) {
  const origin = publicOrigin(req)
  const done = (q: string) => {
    const res = NextResponse.redirect(`${origin}/mensalidades?${q}`)
    res.cookies.set("btg_state", "", { path: "/api/btg", maxAge: 0 })
    return res
  }
  const sb = await adminClient()
  if (!sb) return NextResponse.redirect(`${origin}/login`)
  const url = new URL(req.url)
  const cookie = req.headers.get("cookie")?.match(/(?:^|;\s*)btg_state=([0-9a-f]+)/)?.[1]
  if (url.searchParams.get("error")) return done("btg=negado")
  const code = url.searchParams.get("code")
  if (!code || !cookie || cookie !== url.searchParams.get("state")) return done("btg=erro")
  try {
    const { data: { user } } = await sb.auth.getUser()
    await connectWithCode(code, btgRedirectUri(req), user!.id)
    return done("btg=ok")
     } catch (e) {
     console.error("[btg/callback]", e instanceof Error ? e.message : e)
     return done("btg=erro")
   }
}
