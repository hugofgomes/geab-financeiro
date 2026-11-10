import { authorizeUrl, btgConfigured, newPkce } from "@/lib/btg"
import { adminClient, isOwnerOrg } from "@/lib/server-auth"
import { btgRedirectUri, publicOrigin } from "@/lib/origin"
import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"

/** Começa o login do BTG (Diretoria). O usuário autoriza no BTG e volta para /api/btg/callback. */
export async function GET(req: Request) {
  const back = (q: string) => NextResponse.redirect(`${publicOrigin(req)}/mensalidades?${q}`)
  const sb = await adminClient()
  if (!sb) return NextResponse.redirect(`${publicOrigin(req)}/login`)
  if (!btgConfigured() || !(await isOwnerOrg(sb))) return back("btg=nao-configurado")
  const state = randomBytes(16).toString("hex")
  const { verifier, challenge } = newPkce()
  const res = NextResponse.redirect(authorizeUrl(btgRedirectUri(req), state, challenge))
  const cookie = { httpOnly: true, sameSite: "lax" as const, secure: publicOrigin(req).startsWith("https"), path: "/api/btg", maxAge: 600 }
  res.cookies.set("btg_state", state, cookie)
  res.cookies.set("btg_verifier", verifier, cookie)
  return res
}
