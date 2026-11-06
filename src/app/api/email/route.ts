import { adminClient } from "@/lib/server-auth"
import { emailConfigured, sendPaymentEmails } from "@/lib/email-send"
import { NextResponse } from "next/server"

export const maxDuration = 60

export async function GET() {
  if (!(await adminClient())) return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 })
  return NextResponse.json({ configured: emailConfigured() })
}

/** Envia o e-mail de pagamento recebido para as mensalidades informadas (Diretoria). */
export async function POST(req: Request) {
  const sb = await adminClient()
  if (!sb) return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 })
  if (!emailConfigured()) return NextResponse.json({ error: "E-mail não configurado neste servidor." }, { status: 503 })
  const body = (await req.json().catch(() => ({}))) as { charge_ids?: unknown }
  const ids = Array.isArray(body.charge_ids) ? [...new Set(body.charge_ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))] : []
  if (!ids.length || ids.length > 60) return NextResponse.json({ error: "Informe de 1 a 60 mensalidades." }, { status: 400 })
  return NextResponse.json({ results: await sendPaymentEmails(sb, ids) })
}
