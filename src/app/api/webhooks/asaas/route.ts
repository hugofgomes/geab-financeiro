import { serviceClient } from "@/lib/supabase/service"
import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"

type Payload = { event?: string; payment?: { subscription?: string; dueDate?: string }; subscription?: { id?: string } }

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * Webhook do Asaas: pagamento confirmado/vencido e assinatura cancelada. Sem sessão de usuário: a autenticidade vem do token
 * (cabeçalho asaas-access-token) combinado no painel do Asaas. A decisão de ativar/suspender é da função do banco (idempotente).
 */
export async function POST(req: Request) {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN
  if (!expected) return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 })
  if (!same(req.headers.get("asaas-access-token") ?? "", expected)) return NextResponse.json({ error: "Token inválido." }, { status: 401 })
  const raw = await req.text()
  if (raw.length > 100_000) return NextResponse.json({ error: "Corpo grande demais." }, { status: 413 })
  let p: Payload
  try { p = JSON.parse(raw) as Payload } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }) }

  const sub = p.payment?.subscription ?? p.subscription?.id
  if (!p.event || !sub) return NextResponse.json({ ignored: p.event ?? "sem evento" })   // cobranças avulsas e outros eventos
  const due = p.payment?.dueDate ? new Date(p.payment.dueDate + "T12:00:00Z") : null
  const paidUntil = due && !Number.isNaN(due.getTime()) ? new Date(due.getTime() + 31 * 86_400_000).toISOString() : null

  const sb = serviceClient()
  if (!sb) return NextResponse.json({ error: "Servidor sem chave de serviço configurada." }, { status: 500 })
  const { data, error } = await sb.rpc("billing_event", { p_subscription: sub, p_event: p.event, p_paid_until: paidUntil })
  if (error) return NextResponse.json({ error: "Falha ao registrar." }, { status: 500 })   // o Asaas tenta de novo
  return NextResponse.json({ result: data })
}
