import { sendDueNotifications } from "@/lib/billing-notify"
import { serviceClient } from "@/lib/supabase/service"
import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"

export const maxDuration = 120
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Chamada uma vez por dia pelo agendamento do Coolify. Sem sessão: a autenticidade vem do segredo CRON_SECRET (Authorization: Bearer). */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 20) return NextResponse.json({ error: "Agendamento não configurado." }, { status: 503 })
  const auth = req.headers.get("authorization") ?? ""
  if (!same(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 })
  const sb = serviceClient()
  if (!sb) return NextResponse.json({ error: "Servidor sem chave de serviço configurada." }, { status: 500 })
  try {
    const { items: _items, ...summary } = await sendDueNotifications(sb)
    void _items
    return NextResponse.json(summary)   // só contagens: nada de nomes ou e-mails na resposta
  } catch { return NextResponse.json({ error: "Falha ao processar avisos." }, { status: 500 }) }
}
export const GET = run
export const POST = run
