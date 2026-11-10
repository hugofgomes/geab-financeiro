import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { isAdminOnlyPath, isStaff } from "@/lib/roles"

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
  // A confirmação de e-mail abre em qualquer navegador, logado ou não.
  if (path === "/auth/confirmar") return res
  if (!user) return path === "/login" || path === "/cadastro" || path === "/novo-grupo" ? res : go("/login")

  const { data: p } = await sb.from("profiles").select("role, active").eq("id", user.id).maybeSingle()
  // Usuário confirmado, mas ainda sem perfil liberado (pré-cadastro aguardando aprovação).
  if (!p?.active) return path === "/cadastro/status" ? res : go("/cadastro/status")
  // Administrador e Diretoria usam o painel; Atleta usa o portal.
  const staff = isStaff(p.role)
  if (path === "/cadastro" || path === "/cadastro/status" || path === "/novo-grupo") return go(staff ? "/" : "/atleta")
  // A área do atleta é exatamente /atleta (e subrotas); /atletas é a lista do painel.
  const inPortal = path === "/atleta" || path.startsWith("/atleta/")
  const home = staff ? "/" : "/atleta"
  if (path === "/login") return go(home)
  if (!staff && !inPortal) return go("/atleta")
  if (staff && inPortal) return go("/")
  // Diretoria só consulta: usuários, importação, configurações do grupo e operações ao vivo ficam só com o administrador.
  if (p.role === "diretoria" && isAdminOnlyPath(path)) return go("/")
  return res
}

export const config = { matcher: ["/((?!api/versao|api/webhooks|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"] }
