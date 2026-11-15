import { mailerConfigured, sendBroadcastMail, transporter } from "@/lib/broadcast-mail"
import { platformOwner } from "@/lib/server-auth"
import { serviceClient } from "@/lib/supabase/service"
import { NextResponse } from "next/server"

export const maxDuration = 60
const BATCH = 15
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Envia o próximo lote de e-mails de um comunicado (a tela chama em sequência até não haver pendentes). Só o dono da plataforma. */
export async function POST(req: Request) {
  const owner = await platformOwner()
  if (!owner) return NextResponse.json({ error: "Acesso restrito ao dono da plataforma." }, { status: 403 })
  const { id } = (await req.json().catch(() => ({}))) as { id?: string }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Comunicado inválido." }, { status: 400 })
  if (!mailerConfigured()) return NextResponse.json({ error: "E-mail não configurado no servidor." }, { status: 503 })
  const sb = serviceClient()
  if (!sb) return NextResponse.json({ error: "Servidor sem chave de serviço configurada." }, { status: 500 })

  const { data: c } = await sb.rpc("broadcast_content", { p_id: id })
  const content = (c as { subject: string; body: string; send_email: boolean; image_url: string | null }[] | null)?.[0]
  if (!content?.send_email) return NextResponse.json({ error: "Comunicado não encontrado ou sem envio por e-mail." }, { status: 404 })
  const { data: next, error } = await sb.rpc("broadcast_next", { p_id: id, p_limit: BATCH })
  if (error) return NextResponse.json({ error: "Falha ao ler a fila." }, { status: 500 })

  const tr = transporter()
  const replyTo = owner.user.email ?? process.env.PLATFORM_ALERT_EMAIL ?? null
  for (const r of (next ?? []) as { email: string }[]) {
    let status: "enviado" | "falhou" = "enviado", err: string | null = null
    try { await sendBroadcastMail(tr, r.email, content.subject, content.body, replyTo, content.image_url) }
    catch (e) { status = "falhou"; err = (e instanceof Error ? e.message : "Falha ao enviar").slice(0, 300) }
    await sb.rpc("broadcast_mark", { p_id: id, p_email: r.email, p_status: status, p_error: err })
    await sleep(500)   // respeita o limite de envios por segundo do provedor
  }
  const { data: prog } = await sb.rpc("broadcast_progress", { p_id: id })
  return NextResponse.json(prog ?? {})   // só contagens
}
