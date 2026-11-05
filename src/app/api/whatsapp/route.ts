import { adminClient } from "@/lib/server-auth"
import { formatBRL, formatCompetence } from "@/lib/format"
import { NextResponse } from "next/server"

export const maxDuration = 60

const cfg = () => {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID, template = process.env.WHATSAPP_TEMPLATE
  if (!token || !phoneId || !template) return null
  return {
    token, phoneId, template,
    lang: process.env.WHATSAPP_LANG || "pt_BR",
    base: (process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0").replace(/\/$/, ""),
  }
}

/** O envio automático está configurado neste servidor? (nunca devolve o token) */
export async function GET() {
  if (!(await adminClient())) return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 })
  return NextResponse.json({ configured: !!cfg() })
}

type Result = { charge_id: string; status: "enviado" | "falhou" | "ignorado"; detail?: string }

/**
 * Envia a confirmação de pagamento (modelo aprovado na Meta) para os atletas das mensalidades informadas.
 * Telefone, consentimento e valores vêm do banco — nunca do navegador. Cada mensalidade recebe no máximo uma confirmação.
 */
export async function POST(req: Request) {
  const sb = await adminClient()
  if (!sb) return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 })
  const c = cfg()
  if (!c) return NextResponse.json({ error: "WhatsApp automático não configurado neste servidor." }, { status: 503 })
  const body = (await req.json().catch(() => ({}))) as { charge_ids?: unknown }
  const ids = Array.isArray(body.charge_ids) ? [...new Set(body.charge_ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))] : []
  if (!ids.length || ids.length > 60) return NextResponse.json({ error: "Informe de 1 a 60 mensalidades." }, { status: 400 })

  const results: Result[] = []
  for (const id of ids) {
    const done = (status: Result["status"], detail?: string) => results.push({ charge_id: id, status, detail })
    const { data: ch } = await sb.from("charges").select("id, athlete_id, competence, status").eq("id", id).maybeSingle()
    if (!ch) { done("ignorado", "Mensalidade não encontrada."); continue }
    if (ch.status !== "pago") { done("ignorado", "Mensalidade ainda não quitada."); continue }
    const { data: ath } = await sb.from("athletes").select("full_name, nickname, phone, whatsapp_consent").eq("id", ch.athlete_id).maybeSingle()
    if (!ath?.phone || !ath.whatsapp_consent || !/^\d{10,15}$/.test(ath.phone)) { done("ignorado", "Atleta sem telefone válido ou sem consentimento."); continue }
    const { data: sent } = await sb.from("notifications").select("id").eq("charge_id", id).eq("kind", "confirmacao").eq("status", "enviada").limit(1)
    if (sent?.length) { done("ignorado", "Confirmação já enviada."); continue }
    const { data: pay } = await sb.from("payments").select("amount").eq("charge_id", id)
    const total = (pay ?? []).reduce((a, p) => a + Number(p.amount), 0)
    const nome = (ath.nickname || ath.full_name.split(" ")[0]).slice(0, 60)

    let status: "enviada" | "falhou" = "enviada", error: string | null = null
    try {
      const r = await fetch(`${c.base}/${c.phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp", to: ath.phone, type: "template",
          template: { name: c.template, language: { code: c.lang }, components: [{ type: "body", parameters: [
            { type: "text", text: nome }, { type: "text", text: formatCompetence(ch.competence) }, { type: "text", text: formatBRL(total) },
          ] }] },
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } }
        status = "falhou"; error = (j.error?.message ?? `Erro ${r.status}`).slice(0, 300)
      }
    } catch (e) {
      status = "falhou"; error = e instanceof Error && e.name === "TimeoutError" ? "Tempo esgotado ao falar com o WhatsApp." : "Falha de conexão com o WhatsApp."
    }
    const { error: logErr } = await sb.from("notifications").insert({ athlete_id: ch.athlete_id, charge_id: id, kind: "confirmacao", channel: "whatsapp_api", status, error })
    done(status === "enviada" ? "enviado" : "falhou", status === "enviada" ? (logErr ? "Enviado, mas o registro falhou." : undefined) : error ?? undefined)
  }
  return NextResponse.json({ results })
}
