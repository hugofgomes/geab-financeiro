import { serviceClient } from "@/lib/supabase/service"
import { emailConfigured, sendPaymentEmails } from "@/lib/email-send"
import { sendPaymentConfirmations, whatsappConfigured } from "@/lib/whatsapp-send"
import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"

export const maxDuration = 30

type Event = { webhookId?: string; event?: string; data?: { id?: string; txId?: string; status?: string; paidAmount?: number; paidAt?: string } }

function secretOk(header: string | null) {
  const secret = process.env.BTG_WEBHOOK_SECRET
  if (!secret || !header) return false
  const given = header.replace(/^Bearer\s+/i, "")
  const a = Buffer.from(given), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Aviso do BTG: Pix cobrança paga. Sem sessão de usuário: a autenticidade vem do segredo do webhook (cabeçalho Authorization).
 * Responde rápido (o BTG espera até 10 s); a baixa é feita pela função do banco, idempotente e com checagem de valor.
 */
export async function POST(req: Request) {
  if (!secretOk(req.headers.get("authorization"))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 })
  const raw = await req.text()
  if (raw.length > 100_000) return NextResponse.json({ error: "Corpo grande demais." }, { status: 413 })
  let ev: Event
  try { ev = JSON.parse(raw) as Event } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }) }
  if (ev.event !== "instant-collection.paid") return NextResponse.json({ ignored: ev.event ?? "sem evento" })

  const d = ev.data ?? {}
  const cents = typeof d.paidAmount === "number" ? Math.round(d.paidAmount * 100) : NaN
  const when = d.paidAt ? new Date(d.paidAt) : new Date()
  if (!d.txId || !d.id || d.status !== "PAID" || !Number.isInteger(cents) || cents <= 0 || Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "Dados do pagamento incompletos." }, { status: 400 })
  }
  const sb = serviceClient()
  if (!sb) return NextResponse.json({ error: "Servidor sem chave de serviço configurada." }, { status: 500 })
  const { data, error } = await sb.rpc("register_pix_payment", { p_correlation: d.txId, p_value_cents: cents, p_e2e: `BTG-${d.id}`, p_paid_at: when.toISOString() })
  if (error) return NextResponse.json({ error: "Falha ao registrar." }, { status: 500 }) // o BTG tenta de novo
  const res = data as { result: string; charge_id?: string }

  // WhatsApp em segundo plano: não segura a resposta ao BTG.
  if (res.result === "ok" && res.charge_id && whatsappConfigured()) {
    void sendPaymentConfirmations(sb, [res.charge_id]).catch(() => {})
  }
  if (res.result === "ok" && res.charge_id && emailConfigured()) {
    void sendPaymentEmails(sb, [res.charge_id]).catch(() => {})
  }
  return NextResponse.json({ result: res.result })
}
