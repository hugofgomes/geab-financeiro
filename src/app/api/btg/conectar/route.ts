import { authorizeUrl, btgConfigured } from "@/lib/btg"
import { adminClient } from "@/lib/server-auth"
import { btgRedirectUri, publicOrigin } from "@/lib/origin"
import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"

/** Começa o login do BTG (Diretoria). O usuário autoriza no BTG e volta para /api/btg/callback. */
export async function GET(req: Request) {
  const back = (q: string) => NextResponse.redirect(`${publicOrigin(req)}/mensalidades?${q}`)
  if (!(await adminClient())) return NextResponse.redirect(`${publicOrigin(req)}/login`)
  if (!btgConfigured()) return back("btg=nao-configurado")
  const state = randomBytes(16).toString("hex")
  const res = NextResponse.redirect(authorizeUrl(btgRedirectUri(req), state))
  res.cookies.set("btg_state", state, { httpOnly: true, sameSite: "lax", secure: publicOrigin(req).startsWith("https"), path: "/api/btg", maxAge: 600 })
  return res
}
