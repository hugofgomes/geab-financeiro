import { formatBRL, formatCompetence } from "@/lib/format"
import type { SupabaseClient } from "@supabase/supabase-js"
import nodemailer from "nodemailer"

const cfg = () => {
  const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  const port = Number(process.env.SMTP_PORT || 465)
  return { host, port, user, pass, from: process.env.SMTP_FROM || user }
}
export const emailConfigured = () => !!cfg()

export type EmailResult = { charge_id: string; status: "enviado" | "falhou" | "ignorado"; detail?: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

/** E-mail de confirmação de pagamento, uma vez por mensalidade quitada. Registra o resultado em notifications (canal "email"). */
export async function sendPaymentEmails(sb: SupabaseClient, ids: string[]): Promise<EmailResult[]> {
  const c = cfg()
  const out: EmailResult[] = []
  const tr = c ? nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass }, connectionTimeout: 10_000, socketTimeout: 15_000 }) : null
  for (const id of ids) {
    const done = (status: EmailResult["status"], detail?: string) => out.push({ charge_id: id, status, detail })
    if (!c || !tr) { done("ignorado", "E-mail não configurado."); continue }
    const { data: ch } = await sb.from("charges").select("id, athlete_id, competence, status").eq("id", id).maybeSingle()
    if (!ch) { done("ignorado", "Mensalidade não encontrada."); continue }
    if (ch.status !== "pago") { done("ignorado", "Mensalidade ainda não quitada."); continue }
    const { data: ath } = await sb.from("athletes").select("full_name, nickname, email").eq("id", ch.athlete_id).maybeSingle()
    const to = ath?.email?.trim()
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { done("ignorado", "Atleta sem e-mail válido."); continue }
    const { data: sent } = await sb.from("notifications").select("id").eq("charge_id", id).eq("kind", "confirmacao").eq("channel", "email").eq("status", "enviada").limit(1)
    if (sent?.length) { done("ignorado", "E-mail já enviado."); continue }
    const { data: pay } = await sb.from("payments").select("amount").eq("charge_id", id)
    const total = (pay ?? []).reduce((a, p) => a + Number(p.amount), 0)
    const nome = ath!.nickname || ath!.full_name.split(" ")[0]
    const comp = formatCompetence(ch.competence)

    let status: "enviada" | "falhou" = "enviada", error: string | null = null
    try {
      await tr.sendMail({
        from: `GEAB Futebol <${c.from}>`, to,
        subject: `Pagamento recebido — mensalidade ${comp}`,
        text: `Olá, ${nome}!\n\nRecebemos o pagamento da sua mensalidade de ${comp}: ${formatBRL(total)}.\n\nObrigado!\nGEAB Futebol`,
        html: `<p>Olá, <b>${esc(nome)}</b>!</p><p>Recebemos o pagamento da sua mensalidade de <b>${esc(comp)}</b>: <b>${esc(formatBRL(total))}</b>.</p><p>Obrigado!<br>GEAB Futebol</p>`,
      })
    } catch (e) {
      status = "falhou"; error = (e instanceof Error ? e.message : "Falha ao enviar e-mail").slice(0, 300)
    }
    await sb.from("notifications").insert({ athlete_id: ch.athlete_id, charge_id: id, kind: "confirmacao", channel: "email", status, error })
    done(status === "enviada" ? "enviado" : "falhou", error ?? undefined)
  }
  return out
}
