import { asaas, asaasConfigured, onlyDigits, validCpfCnpj } from "@/lib/asaas"
import { sessionUser } from "@/lib/server-auth"
import { serviceClient } from "@/lib/supabase/service"
import { NextResponse } from "next/server"

export const maxDuration = 60
const fail = (error: string, status: number) => NextResponse.json({ error }, { status })

/**
 * Cria (ou retoma) a assinatura do grupo no Asaas e devolve o link de pagamento (Pix, boleto ou cartão).
 * Quem pode: administrador ativo do grupo, mesmo com o grupo bloqueado. O valor sempre vem do banco, nunca do navegador.
 */
export async function POST(req: Request) {
  if (!asaasConfigured()) return fail("O pagamento online ainda não foi configurado neste servidor.", 503)
  const user = await sessionUser()
  if (!user) return fail("Faça login para assinar.", 401)
  let body: { plan?: unknown; cpfCnpj?: unknown }
  try { body = await req.json() } catch { return fail("Pedido inválido.", 400) }
  const plan = typeof body.plan === "string" ? body.plan : ""
  const doc = typeof body.cpfCnpj === "string" ? onlyDigits(body.cpfCnpj) : ""
  if (!/^[a-z0-9_-]{1,30}$/.test(plan)) return fail("Plano inválido.", 400)
  if (!validCpfCnpj(doc)) return fail("Informe um CPF ou CNPJ válido.", 400)

  const sb = serviceClient()
  if (!sb) return fail("Servidor sem chave de serviço configurada.", 500)
  const prep = await sb.rpc("billing_prepare", { p_user: user.id, p_plan: plan })
  if (prep.error) return fail(prep.error.message.replace(/^.*?: /, ""), 403)
  const r = (prep.data as { org_id: string; org_name: string; price_cents: number; asaas_customer_id: string | null; asaas_subscription_id: string | null; trial_ends_at: string | null; status: string }[])[0]
  if (!r) return fail("Não foi possível preparar a assinatura.", 500)

  try {
    let subscription = r.asaas_subscription_id
    if (!subscription) {
      let customer = r.asaas_customer_id
      if (!customer) customer = (await asaas<{ id: string }>("/customers", { body: { name: r.org_name, email: user.email, cpfCnpj: doc, externalReference: r.org_id } })).id
      // Quem assina durante o teste só paga quando o teste acabar; depois dele, a primeira cobrança é hoje.
      const trialEnd = r.status === "teste" && r.trial_ends_at ? new Date(r.trial_ends_at) : null
      const due = (trialEnd && trialEnd.getTime() > Date.now() ? trialEnd : new Date()).toISOString().slice(0, 10)
      subscription = (await asaas<{ id: string }>("/subscriptions", {
        body: { customer, billingType: "UNDEFINED", value: r.price_cents / 100, nextDueDate: due, cycle: "MONTHLY", description: `GEAB Futebol · plano ${plan}`, externalReference: r.org_id },
      })).id
      const att = await sb.rpc("billing_attach", { p_org: r.org_id, p_customer: customer, p_subscription: subscription, p_plan: plan })
      if (att.error) return fail("Assinatura criada, mas não foi possível registrá-la. Fale com o suporte.", 500)
    }
    const pays = await asaas<{ data?: { invoiceUrl?: string; status?: string }[] }>(`/subscriptions/${subscription}/payments`)
    const open = pays.data?.find((p) => p.invoiceUrl && p.status !== "RECEIVED" && p.status !== "CONFIRMED") ?? pays.data?.[0]
    if (!open?.invoiceUrl) return fail("Assinatura criada. O link de pagamento chega por e-mail; tente também recarregar esta página em instantes.", 202)
    return NextResponse.json({ url: open.invoiceUrl })
  } catch (e) {
    return fail(`Não foi possível criar a cobrança: ${e instanceof Error ? e.message : "erro desconhecido"}`, 502)
  }
}
