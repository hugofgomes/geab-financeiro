// Configura o Asaas por aqui: confere a chave e cria (ou atualiza) o webhook que avisa o GEAB dos pagamentos.
// Uso: node --env-file=.env.deploy scripts/asaas-setup.mjs
const key = process.env.ASAAS_API_KEY, token = process.env.ASAAS_WEBHOOK_TOKEN, site = (process.env.SITE_URL || "").replace(/\/$/, "")
const email = process.env.ASAAS_WEBHOOK_EMAIL
const base = process.env.ASAAS_ENV === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3"
if (!key || !token || !site) { console.error("Preencha ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN e SITE_URL no .env.deploy"); process.exit(1) }
if (!email) { console.error("Preencha ASAAS_WEBHOOK_EMAIL no .env.deploy (e-mail que o Asaas avisa se o webhook falhar)"); process.exit(1) }
const call = async (path, method = "GET", body) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", access_token: key, "user-agent": "geab-futebol" }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, j }
}
console.log(`Ambiente: ${process.env.ASAAS_ENV === "production" ? "PRODUÇÃO" : "sandbox"}`)
const bal = await call("/finance/balance")
if (!bal.ok) { console.error(`✗ A chave foi recusada (${bal.status}): ${bal.j.errors?.[0]?.description ?? "verifique se a chave é do mesmo ambiente"}`); process.exit(1) }
console.log("✓ Chave do Asaas válida")

const url = `${site}/api/webhooks/asaas`
const events = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE", "SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"]
const payload = { name: "GEAB Futebol", url, email, enabled: true, interrupted: false, authToken: token, sendType: "SEQUENTIALLY", apiVersion: 3, events }
const list = await call("/webhooks")
const mine = list.ok ? (list.j.data ?? []).find((w) => w.url === url) : null
const res = mine ? await call(`/webhooks/${mine.id}`, "PUT", payload) : await call("/webhooks", "POST", payload)
if (!res.ok) { console.error(`✗ Não consegui registrar o webhook (${res.status}): ${JSON.stringify(res.j).slice(0, 300)}`); process.exit(1) }
console.log(`✓ Webhook ${mine ? "atualizado" : "criado"}: ${url}`)
