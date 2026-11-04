import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export const maxDuration = 60

async function requireAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return false
  const jar = await cookies()
  const sb = createServerClient(url, key, { cookies: { getAll: () => jar.getAll(), setAll: () => {} } })
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return false
  const { data: p } = await sb.from("profiles").select("role, active").eq("id", user.id).maybeSingle()
  return p?.role === "admin" && p.active === true
}

/** Lê uma planilha "publicada na web" do Google Sheets e devolve o CSV de cada aba. */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 })
  const { url } = (await req.json().catch(() => ({}))) as { url?: string }
  let base: URL
  try {
    base = new URL(url ?? "")
  } catch {
    return NextResponse.json({ error: "Endereço inválido." }, { status: 400 })
  }
  // Só aceita planilhas publicadas do Google (evita usar o servidor para acessar outros endereços).
  if (base.protocol !== "https:" || base.hostname !== "docs.google.com" || !/^\/spreadsheets\/d\/e\/[\w-]+\/pub(html)?$/.test(base.pathname))
    return NextResponse.json({ error: "Use o link de “Publicar na Web” da planilha (termina em /pubhtml)." }, { status: 400 })
  const pub = `https://docs.google.com${base.pathname.replace(/\/pubhtml$/, "/pub")}`

  const html = await fetch(`${pub.replace(/\/pub$/, "/pubhtml")}`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : null)).catch(() => null)
  if (!html) return NextResponse.json({ error: "Não consegui abrir a planilha. Ela está publicada na web?" }, { status: 502 })
  const tabs = [...html.matchAll(/items\.push\(\{name:\s*"([^"]+)"[\s\S]*?gid:\s*"(\d+)"/g)].map((m) => ({ name: JSON.parse(`"${m[1]}"`) as string, gid: m[2] }))
  if (!tabs.length) return NextResponse.json({ error: "Nenhuma aba encontrada na planilha." }, { status: 422 })

  const out: { name: string; gid: string; csv: string }[] = []
  const queue = [...tabs]
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const csv = await fetch(`${pub}?gid=${t.gid}&single=true&output=csv`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")).catch(() => "")
        out.push({ ...t, csv })
      }
    }),
  )
  const order = new Map(tabs.map((t, i) => [t.gid, i]))
  out.sort((a, b) => order.get(a.gid)! - order.get(b.gid)!)
  return NextResponse.json({ tabs: out })
}
