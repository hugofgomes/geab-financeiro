import { createServerClient } from "@supabase/ssr"
import type { EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

/** Link do e-mail de confirmação: troca o token por uma sessão (funciona em qualquer navegador). */
export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const tokenHash = req.nextUrl.searchParams.get("token_hash")
  const type = req.nextUrl.searchParams.get("type") as EmailOtpType | null
  // Atrás do proxy do Coolify, nextUrl aponta para o endereço interno do container (0.0.0.0:3000).
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")
  const to = (path: string) => new URL(path, `${proto}://${host}`)
  const code = req.nextUrl.searchParams.get("code")
  if (url && key && code && !tokenHash) {   // modelo padrão do Supabase (fluxo PKCE): o link volta com ?code=
    const res = NextResponse.redirect(to("/redefinir-senha"))
    const sb = createServerClient(url, key, { cookies: { getAll: () => req.cookies.getAll(), setAll: (list) => list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)) } })
    const { error } = await sb.auth.exchangeCodeForSession(code)
    return error ? NextResponse.redirect(to("/login?erro=link-invalido")) : res
  }
  if (!url || !key || !tokenHash || (type !== "email" && type !== "invite" && type !== "recovery")) return NextResponse.redirect(to("/login?erro=link-invalido"))

  // Recuperação de senha e convite: entra com o link e define a senha na tela seguinte.
  const res = NextResponse.redirect(to(type === "recovery" || type === "invite" ? "/redefinir-senha" : "/cadastro/status?confirmado=1"))
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
