import { adminClient } from "@/lib/server-auth"
import { publicOrigin } from "@/lib/origin"
import { serviceClient } from "@/lib/supabase/service"
import { NextResponse, type NextRequest } from "next/server"

const ROLES = ["gerente", "recepcionista", "financeiro"]

/** Administrador do centro convida um funcionário: o convite chega por e-mail e a própria pessoa cria a senha (nenhuma senha passa por aqui). */
export async function POST(req: NextRequest) {
  const sb = await adminClient()
  if (!sb) return NextResponse.json({ error: "Apenas o administrador do estabelecimento." }, { status: 403 })
  const { data: role } = await sb.rpc("court_role")
  if (role !== "admin") return NextResponse.json({ error: "Apenas o administrador do estabelecimento." }, { status: 403 })
  const svc = serviceClient()
  if (!svc) return NextResponse.json({ error: "Chave de serviço não configurada no servidor." }, { status: 500 })

  const b = (await req.json().catch(() => ({}))) as { name?: string; email?: string; role?: string; position?: string }
  const name = (b.name ?? "").trim().replace(/\s+/g, " "), email = (b.email ?? "").trim().toLowerCase()
  if (name.length < 2 || name.length > 120) return NextResponse.json({ error: "Informe o nome do funcionário." }, { status: 400 })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 })
  if (!b.role || !ROLES.includes(b.role)) return NextResponse.json({ error: "Perfil inválido." }, { status: 400 })

  // Tenant vem do perfil do administrador logado (leitura com a sessão dele), nunca do navegador.
  const { data: tn } = await sb.rpc("current_tenant")
  if (!tn) return NextResponse.json({ error: "Estabelecimento não identificado." }, { status: 400 })

  const { data: inv, error } = await svc.auth.admin.inviteUserByEmail(email, { data: { full_name: name }, redirectTo: `${publicOrigin(req)}/redefinir-senha` })
  if (error || !inv.user) {
    const dup = /already|registered|exists/i.test(error?.message ?? "")
    return NextResponse.json({ error: dup ? "Já existe uma conta com este e-mail." : `Não foi possível enviar o convite: ${error?.message}` }, { status: dup ? 409 : 502 })
  }
  // Funcionário usa o nível "diretoria" do sistema (somente leitura fora do módulo); as permissões reais ficam em court_staff.
  const { error: pe } = await svc.from("profiles").insert({ tenant_id: tn, id: inv.user.id, full_name: name, role: "diretoria", active: true })
  const { error: se } = pe ? { error: pe } : await svc.from("court_staff").insert({ tenant_id: tn, profile_id: inv.user.id, role: b.role, position: (b.position ?? "").trim().slice(0, 60) || null })
  if (pe || se) {
    await svc.auth.admin.deleteUser(inv.user.id) // não deixa conta órfã
    return NextResponse.json({ error: `Não foi possível cadastrar o funcionário: ${(pe ?? se)!.message}` }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

/** Reenvia o convite/recuperação de acesso para um funcionário do próprio estabelecimento. */
export async function PUT(req: NextRequest) {
  const sb = await adminClient()
  if (!sb) return NextResponse.json({ error: "Apenas o administrador do estabelecimento." }, { status: 403 })
  const { data: role } = await sb.rpc("court_role")
  if (role !== "admin") return NextResponse.json({ error: "Apenas o administrador do estabelecimento." }, { status: 403 })
  const svc = serviceClient()
  if (!svc) return NextResponse.json({ error: "Chave de serviço não configurada no servidor." }, { status: 500 })
  const { profile_id } = (await req.json().catch(() => ({}))) as { profile_id?: string }
  if (!profile_id) return NextResponse.json({ error: "Funcionário não informado." }, { status: 400 })
  // A lista vem do banco com a sessão do administrador: só enxerga funcionários do próprio estabelecimento.
  const { data: list } = await sb.rpc("court_staff_list")
  const row = (Array.isArray(list) ? list : []).find((r: { profile_id: string }) => r.profile_id === profile_id) as { email: string; active: boolean } | undefined
  if (!row) return NextResponse.json({ error: "Funcionário não encontrado." }, { status: 404 })
  if (!row.active) return NextResponse.json({ error: "Funcionário bloqueado: reative antes de reenviar o acesso." }, { status: 409 })
  const { error } = await svc.auth.resetPasswordForEmail(row.email, { redirectTo: `${publicOrigin(req)}/redefinir-senha` })
  if (error) return NextResponse.json({ error: "Não foi possível enviar o e-mail agora." }, { status: 502 })
  return NextResponse.json({ ok: true })
}
