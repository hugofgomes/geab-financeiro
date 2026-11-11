import { adminClient } from "@/lib/server-auth"
import { serviceClient } from "@/lib/supabase/service"
import { randomInt } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

const novaSenha = () => { const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({ length: 10 }, () => c[randomInt(c.length)]).join("") }

/** Administrador libera o acesso (login) de um atleta cadastrado: cria a conta com senha provisória e vincula ao atleta. */
export async function POST(req: NextRequest) {
  const sb = await adminClient()
  if (!sb) return NextResponse.json({ error: "Apenas administradores." }, { status: 403 })
  const svc = serviceClient()
  if (!svc) return NextResponse.json({ error: "Chave de serviço não configurada no servidor (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 500 })

  const { athlete_id } = (await req.json().catch(() => ({}))) as { athlete_id?: string }
  if (!athlete_id) return NextResponse.json({ error: "Atleta não informado." }, { status: 400 })

  // Leitura com a sessão do admin: as regras do banco garantem que o atleta é do grupo dele.
  const { data: a } = await sb.from("athletes").select("id, tenant_id, full_name, email").eq("id", athlete_id).maybeSingle()
  if (!a) return NextResponse.json({ error: "Atleta não encontrado." }, { status: 404 })
  const email = (a.email ?? "").trim().toLowerCase()
  if (!email) return NextResponse.json({ error: "Informe o e-mail do atleta para criar o acesso." }, { status: 400 })

  const { data: linked } = await svc.from("profiles").select("id").eq("athlete_id", a.id).maybeSingle()
  if (linked) return NextResponse.json({ error: "Este atleta já tem acesso." }, { status: 409 })

  // Conta criada direto pelo administrador, já confirmada, com senha provisória (o atleta troca depois em "Minha conta").
  const senha = novaSenha()
  const { data: inv, error } = await svc.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { full_name: a.full_name } })
  if (error || !inv.user) {
    const dup = /already|registered|exists/i.test(error?.message ?? "")
    return NextResponse.json({ error: dup ? "Já existe uma conta com este e-mail. Se ela estiver pendente, aprove em Cadastros." : `Não foi possível criar a conta: ${error?.message}` }, { status: dup ? 409 : 502 })
  }

  const { error: pe } = await svc.from("profiles").insert({ tenant_id: a.tenant_id, id: inv.user.id, full_name: a.full_name, role: "atleta", athlete_id: a.id, active: true })
  if (pe) {
    await svc.auth.admin.deleteUser(inv.user.id) // não deixa conta órfã sem perfil
    return NextResponse.json({ error: `Não foi possível vincular a conta: ${pe.message}` }, { status: 500 })
  }
  return NextResponse.json({ ok: true, email, senha })
}
