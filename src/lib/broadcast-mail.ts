import nodemailer from "nodemailer"

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
const brand = () => process.env.SMTP_FROM_NAME || "Gestão de Futebol"

export const mailerConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)

export function transporter() {
  const port = Number(process.env.SMTP_PORT || 465)
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, connectionTimeout: 10_000, socketTimeout: 15_000 })
}

/** Texto digitado vira parágrafos (linha em branco separa) e links https viram clicáveis. Nada de HTML cru. */
function paragraphs(body: string) {
  return body.trim().split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 14px;line-height:1.55">${esc(p).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0057B8">$1</a>').replace(/\n/g, "<br>")}</p>`).join("")
}

export function buildBroadcastEmail(subject: string, body: string) {
  const footer = `Você recebe este comunicado como responsável por um grupo na plataforma ${brand()}. Para não receber mais comunicados, responda este e-mail pedindo a retirada.`
  return {
    text: `${body.trim()}\n\n—\n${footer}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:0 auto">
<div style="background:#1E3A5F;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-size:18px;font-weight:bold">${esc(brand())}</div>
<div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 12px 12px">
<h1 style="font-size:20px;margin:0 0 16px;color:#17365D">${esc(subject)}</h1>${paragraphs(body)}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">${esc(footer)}</p></div></div>`,
  }
}

export async function sendBroadcastMail(tr: ReturnType<typeof transporter>, to: string, subject: string, body: string, replyTo?: string | null) {
  const m = buildBroadcastEmail(subject, body)
  await tr.sendMail({ from: `${brand()} <${process.env.SMTP_FROM || process.env.SMTP_USER}>`, to, subject, text: m.text, html: m.html, ...(replyTo ? { replyTo } : {}) })
}
