import { createServerClient } from "@supabase/ssr"
import type { EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

/** Link do e-mail de confirmação: troca o token por uma sessão (funciona em qualquer navegador). */
export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const tokenHash = req.nextUrl.searchParams.get("token_hash")
  const type = req.nextUrl.searchParams.get("type") as EmailOtpType | null
  const to = (path: string) => {
    const u = req.nextUrl.clone()
    u.pathname = path.split("?")[0]
    u.search = path.includes("?") ? "?" + path.split("?")[1] : ""
    return u
  }
  if (!url || !key || !tokenHash || type !== "email") return NextResponse.redirect(to("/login?erro=link-invalido"))

  const res = NextResponse.redirect(to("/cadastro/status?confirmado=1"))
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  })
  const { error } = await sb.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error) return NextResponse.redirect(to("/login?erro=link-invalido"))
  return res
}
