import net from "node:net"
process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = "2525"; process.env.SMTP_USER = "u"; process.env.SMTP_PASS = "p"; process.env.SMTP_FROM = "geab@x.com"
let mail = ""
const srv = net.createServer((s) => {
  let data = false
  s.write("220 ok\r\n")
  s.on("data", (b) => {
    for (const l of b.toString().split("\r\n")) {
      if (data) { mail += l + "\n"; if (l === ".") { data = false; s.write("250 queued\r\n") } continue }
      if (/^EHLO/i.test(l)) s.write("250-ok\r\n250 AUTH PLAIN LOGIN\r\n")
      else if (/^AUTH/i.test(l)) s.write("235 ok\r\n")
      else if (/^(MAIL|RCPT)/i.test(l)) s.write("250 ok\r\n")
      else if (/^DATA/i.test(l)) { data = true; s.write("354 go\r\n") }
      else if (/^QUIT/i.test(l)) { s.write("221 bye\r\n"); s.end() }
    }
  })
})
const rows: Record<string, any> = {
  charges: { id: "c1", athlete_id: "a1", competence: "2026-11-01", status: "pago" },
  athletes: { full_name: "João Silva", nickname: null, email: "joao@x.com" },
}
const log: any[] = []
const sb: any = { from: (t: string) => {
  const q: any = { select: () => q, eq: () => q, neq: () => q, limit: () => q, maybeSingle: async () => ({ data: rows[t] }),
    insert: async (r: any) => { log.push(r); return {} },
    then: (res: any) => res({ data: t === "payments" ? [{ amount: 100 }] : log.some((l) => l.status === "enviada") ? [{ id: 1 }] : [] }) }
  return q
} }
const ok = (n: string, c: boolean) => console.log(c ? "PASS" : "FAIL", n)
srv.listen(2525, async () => {
  const { sendPaymentEmails } = await import("../src/lib/email-send")
  const r1 = await sendPaymentEmails(sb, ["c1"])
  ok("enviou", r1[0].status === "enviado")
  ok("destinatário e valor", mail.includes("joao@x.com") && /100,00/.test(mail))
  ok("registrou notificação email", log[0]?.channel === "email" && log[0]?.status === "enviada")
  const r2 = await sendPaymentEmails(sb, ["c1"])
  ok("não repete", r2[0].status === "ignorado")
  rows.athletes.email = null; log.length = 0
  const r3 = await sendPaymentEmails(sb, ["c1"])
  ok("sem e-mail ignora", r3[0].status === "ignorado")
  rows.charges.status = "pendente"
  ok("não quitada ignora", (await sendPaymentEmails(sb, ["c1"]))[0].status === "ignorado")
  srv.close(); process.exit(0)
})
