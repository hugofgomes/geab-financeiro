import type { SupabaseClient } from "@supabase/supabase-js"
import nodemailer from "nodemailer"

type Candidate = { org_id: string; org_name: string; kind: "trial_3d" | "trial_1d" | "trial_fim" | "inadimplencia"; ref: string; trial_ends_at: string | null; emails: string[] }
export type NotifySummary = { candidates: number; sent: number; failed: number; skipped: number; items: { org: string; kind: string; status: string }[] }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "")

function content(c: Candidate) {
  const o = c.org_name
  switch (c.kind) {
    case "trial_3d": return { subject: `Seu teste gratuito termina em 3 dias — ${o}`, lines: [`O teste gratuito do grupo ${o} termina em ${date(c.trial_ends_at)}.`, "Assine agora para não perder o acesso. Seus dados ficam guardados."] }
    case "trial_1d": return { subject: `Último dia do seu teste gratuito — ${o}`, lines: [`O teste gratuito do grupo ${o} termina amanhã (${date(c.trial_ends_at)}).`, "Assine hoje para continuar usando sem interrupção."] }
    case "trial_fim": return { subject: `Seu teste gratuito terminou — ${o}`, lines: [`O teste gratuito do grupo ${o} terminou em ${date(c.trial_ends_at)} e o acesso foi bloqueado.`, "Seus dados estão guardados e voltam assim que a assinatura for confirmada."] }
    case "inadimplencia": return { subject: `Pagamento pendente — ${o}`, lines: [`Não identificamos o pagamento da assinatura do grupo ${o} e o acesso foi suspenso.`, "Regularize o pagamento para voltar a usar, sem perder nenhum dado."] }
  }
}

/** Envia os avisos de vencimento pendentes (uma vez cada) e, se configurado, um resumo para o dono da plataforma. */
export async function sendDueNotifications(sb: SupabaseClient): Promise<NotifySummary> {
  const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASS
  const sum: NotifySummary = { candidates: 0, sent: 0, failed: 0, skipped: 0, items: [] }
  const { data, error } = await sb.rpc("billing_notify_candidates")
  if (error) throw new Error(error.message)
  const list = (data ?? []) as Candidate[]
  sum.candidates = list.length
  if (!host || !user || !pass) { sum.skipped = list.length; return sum }
  const port = Number(process.env.SMTP_PORT || 465)
  const from = process.env.SMTP_FROM || user
  const brand = process.env.SMTP_FROM_NAME || "Gestão de Futebol"
  const link = `${process.env.APP_URL || "https://geab.vendadigital.com"}/assinatura`
  const tr = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass }, connectionTimeout: 10_000, socketTimeout: 15_000 })

  for (const c of list) {
    if (!c.emails.length) { sum.skipped++; continue }
    const m = content(c)
    let status: "enviada" | "falhou" = "enviada", err: string | null = null
    try {
      await tr.sendMail({
        from: `${brand} <${from}>`, to: c.emails, subject: m.subject,
        text: `${m.lines.join("\n\n")}\n\nAssinar: ${link}\n\n${brand}`,
        html: `${m.lines.map((l) => `<p>${esc(l)}</p>`).join("")}<p><a href="${esc(link)}">Ir para a assinatura</a></p><p>${esc(brand)}</p>`,
      })
    } catch (e) { status = "falhou"; err = (e instanceof Error ? e.message : "Falha ao enviar").slice(0, 300) }
    await sb.rpc("billing_notify_mark", { p_org: c.org_id, p_kind: c.kind, p_ref: c.ref, p_emails: c.emails, p_status: status, p_error: err })
    if (status === "enviada") sum.sent++; else sum.failed++
    sum.items.push({ org: c.org_name, kind: c.kind, status })
  }

  const owner = process.env.PLATFORM_ALERT_EMAIL
  if (owner && sum.items.length) {
    const rows = sum.items.map((i) => `${i.org} — ${i.kind} — ${i.status}`)
    await tr.sendMail({ from: `${brand} <${from}>`, to: owner, subject: `Resumo de vencimentos: ${sum.sent} aviso(s) enviado(s)`,
      text: rows.join("\n"), html: `<p>Avisos de vencimento enviados hoje:</p><ul>${rows.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` }).catch(() => {})
  }
  return sum
}
