import { verifyWebhook } from "@/lib/openpix"
import { serviceClient } from "@/lib/supabase/service"
import { emailConfigured, sendPaymentEmails } from "@/lib/email-send"
import { sendPaymentConfirmations, whatsappConfigured } from "@/lib/whatsapp-send"
import { NextResponse } from "next/server"

export const maxDuration = 60

type Payload = {
  event?: string
  charge?: { correlationID?: string; value?: number }
  pix?: { endToEndId?: string; value?: number; time?: string }
}

/**
 * Webhook do OpenPix: cobrança Pix paga. Sem sessão de usuário: a autenticidade vem da assinatura RSA do corpo bruto.
 * A baixa é feita pela função do banco (idempotente e com checagem de valor); o WhatsApp só sai se a baixa ocorreu agora.
 */
export async function POST(req: Request) {
  const raw = await req.text()
  if (raw.length > 100_000) return NextResponse.json({ error: "Corpo grande demais." }, { status: 413 })
  let valid = false
  try { valid = await verifyWebhook(raw, req.headers.get("x-webhook-signature")) } catch { return NextResponse.json({ error: "Não foi possível validar a assinatura agora." }, { status: 503 }) }
  if (!valid) return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 })

  let p: Payload
  try { p = JSON.parse(raw) as Payload } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }) }
  if (p.event !== "OPENPIX:CHARGE_COMPLETED") return NextResponse.json({ ignored: p.event ?? "sem evento" }) // outros eventos e o teste do painel

  const key = p.charge?.correlationID, e2e = p.pix?.endToEndId
  const cents = p.pix?.value ?? p.charge?.value
  const when = p.pix?.time ? new Date(p.pix.time) : new Date()
  if (!key || !e2e || !Number.isInteger(cents) || Number.isNaN(when.getTime())) return NextResponse.json({ error: "Dados do pagamento incompletos." }, { status: 400 })

  const sb = serviceClient()
  if (!sb) return NextResponse.json({ error: "Servidor sem chave de serviço configurada." }, { status: 500 })
  const { data, error } = await sb.rpc("register_pix_payment", { p_correlation: key, p_value_cents: cents, p_e2e: e2e, p_paid_at: when.toISOString() })
  if (error) return NextResponse.json({ error: "Falha ao registrar." }, { status: 500 }) // o OpenPix tenta de novo
  const res = data as { result: string; charge_id?: string }

  let whatsapp: unknown = null
  if (res.result === "ok" && res.charge_id && whatsappConfigured()) {
    try { whatsapp = await sendPaymentConfirmations(sb, [res.charge_id]) } catch { whatsapp = "falha" }
  }
  if (res.result === "ok" && res.charge_id && emailConfigured()) {
    try { await sendPaymentEmails(sb, [res.charge_id]) } catch {}
  }
  return NextResponse.json({ result: res.result, whatsapp })
}
