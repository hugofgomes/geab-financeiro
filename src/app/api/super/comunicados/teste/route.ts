import { isBroadcastImage, mailerConfigured, sendBroadcastMail, transporter } from "@/lib/broadcast-mail"
import { platformOwner } from "@/lib/server-auth"
import { NextResponse } from "next/server"

/** Envia o comunicado só para o e-mail de quem está logado (o dono), para conferir antes de mandar para todos. */
export async function POST(req: Request) {
  const owner = await platformOwner()
  if (!owner?.user.email) return NextResponse.json({ error: "Acesso restrito ao dono da plataforma." }, { status: 403 })
  if (!mailerConfigured()) return NextResponse.json({ error: "E-mail não configurado no servidor." }, { status: 503 })
  const { subject, body, imageUrl } = (await req.json().catch(() => ({}))) as { subject?: string; body?: string; imageUrl?: string | null }
  if (!subject || subject.trim().length < 3 || subject.length > 150 || !body || body.trim().length < 3 || body.length > 5000) return NextResponse.json({ error: "Informe assunto e mensagem." }, { status: 400 })
  try { await sendBroadcastMail(transporter(), owner.user.email, `[TESTE] ${subject.trim()}`, body, owner.user.email, isBroadcastImage(imageUrl) ? imageUrl : null) }
  catch { return NextResponse.json({ error: "Não foi possível enviar o teste." }, { status: 502 }) }
  return NextResponse.json({ ok: true, to: owner.user.email })
}
