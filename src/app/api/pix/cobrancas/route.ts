import { createPixCharge, openpixConfigured } from "@/lib/openpix"
import { formatCompetence } from "@/lib/format"
import { adminClient } from "@/lib/server-auth"
import { NextResponse } from "next/server"

export const maxDuration = 60
const DAYS = 30

export async function GET() {
  if (!(await adminClient())) return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 })
  return NextResponse.json({ configured: openpixConfigured() })
}

type Result = { charge_id: string; status: "criada" | "existente" | "ignorada" | "falhou"; detail?: string }

/** Gera o Pix (QR e copia e cola) das mensalidades em aberto informadas. Valor e atleta vêm do banco. */
export async function POST(req: Request) {
  const sb = await adminClient()
  if (!sb) return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 })
  if (!openpixConfigured()) return NextResponse.json({ error: "Pix automático não configurado neste servidor." }, { status: 503 })
  const body = (await req.json().catch(() => ({}))) as { charge_ids?: unknown }
  const ids = Array.isArray(body.charge_ids) ? [...new Set(body.charge_ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))] : []
  if (!ids.length || ids.length > 80) return NextResponse.json({ error: "Informe de 1 a 80 mensalidades." }, { status: 400 })

  const results: Result[] = []
  for (const id of ids) {
    const out = (status: Result["status"], detail?: string) => results.push({ charge_id: id, status, detail })
    const { data: c } = await sb.from("charges_view").select("id, athlete_id, competence, balance").eq("id", id).maybeSingle()
    if (!c) { out("ignorada", "Mensalidade não encontrada."); continue }
    const cents = Math.round(Number(c.balance) * 100)
    if (cents <= 0) { out("ignorada", "Mensalidade já quitada."); continue }
    const { data: live } = await sb.from("pix_charges").select("id, value_cents, expires_at").eq("charge_id", id).eq("status", "ativa").order("created_at", { ascending: false }).limit(1)
    const cur = live?.[0]
    if (cur && cur.value_cents === cents && (!cur.expires_at || new Date(cur.expires_at).getTime() > Date.now() + 86_400_000)) { out("existente"); continue }
    const { data: a } = await sb.from("athletes").select("full_name, nickname").eq("id", c.athlete_id).maybeSingle()
    const name = a?.full_name ?? "Atleta"
    const correlation = `geab-${id}-${Date.now().toString(36)}`
    try {
      const ch = await createPixCharge({ correlationID: correlation, valueCents: cents, comment: `Mensalidade ${formatCompetence(c.competence)} - GEAB`, customerName: name, expiresInSeconds: DAYS * 86_400 })
      const { error } = await sb.from("pix_charges").insert({
        charge_id: id, athlete_id: c.athlete_id, correlation_id: correlation, value_cents: cents,
        br_code: ch.brCode, payment_link: ch.paymentLinkUrl, qr_image: ch.qrCodeImage, expires_at: new Date(Date.now() + DAYS * 86_400_000).toISOString(),
      })
      if (error) out("falhou", "Cobrança criada no OpenPix, mas o registro falhou: " + error.message)
      else out("criada")
    } catch (e) {
      out("falhou", e instanceof Error && e.name === "TimeoutError" ? "Tempo esgotado ao falar com o OpenPix." : e instanceof Error ? e.message : "Erro desconhecido.")
    }
  }
  return NextResponse.json({ results })
}
