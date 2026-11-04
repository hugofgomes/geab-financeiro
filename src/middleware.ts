import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return NextResponse.next()

  let res = NextResponse.next({ request: req })
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value))
        res = NextResponse.next({ request: req })
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
      },
    },
  })
  const go = (to: string) => {
    const u = req.nextUrl.clone()
    u.pathname = to
    u.search = ""
    return NextResponse.redirect(u)
  }
  const path = req.nextUrl.pathname
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return path === "/login" ? res : go("/login")

  const { data: p } = await sb.from("profiles").select("role, active").eq("id", user.id).maybeSingle()
  if (!p?.active) return path === "/login" ? res : go("/login?erro=sem-perfil")
  // A área do atleta é exatamente /atleta (e subrotas); /atletas é a lista do administrador.
  const inPortal = path === "/atleta" || path.startsWith("/atleta/")
  const home = p.role === "admin" ? "/" : "/atleta"
  if (path === "/login") return go(home)
  if (p.role === "atleta" && !inPortal) return go("/atleta")
  if (p.role === "admin" && inPortal) return go("/")
  return res
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"] }
