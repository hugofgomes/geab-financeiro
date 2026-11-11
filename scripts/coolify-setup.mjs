// Cria/atualiza as variáveis do Asaas no Coolify e (com --deploy) dispara o deploy. Os valores vêm do .env.deploy, nunca do chat.
// Uso: node --env-file=.env.deploy scripts/coolify-setup.mjs [--deploy]
const { COOLIFY_URL, COOLIFY_TOKEN, COOLIFY_APP_UUID } = process.env
if (!COOLIFY_URL || !COOLIFY_TOKEN || !COOLIFY_APP_UUID) { console.error("Preencha COOLIFY_URL, COOLIFY_TOKEN e COOLIFY_APP_UUID no .env.deploy"); process.exit(1) }
const api = async (path, method = "GET", body) => {
  const r = await fetch(COOLIFY_URL.replace(/\/$/, "") + "/api/v1" + path, { method, headers: { authorization: `Bearer ${COOLIFY_TOKEN}`, "content-type": "application/json", accept: "application/json" }, body: body ? JSON.stringify(body) : undefined })
  return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }
}
const vars = { ASAAS_API_KEY: process.env.ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN: process.env.ASAAS_WEBHOOK_TOKEN, ASAAS_ENV: process.env.ASAAS_ENV || "sandbox" }
const cur = await api(`/applications/${COOLIFY_APP_UUID}/envs`)
if (!cur.ok) { console.error(`✗ Coolify recusou (${cur.status}). Confira a URL, o token e o UUID.`); process.exit(1) }
const have = new Map((Array.isArray(cur.j) ? cur.j : []).map((e) => [e.key, e]))
console.log("SUPABASE_SERVICE_ROLE_KEY existe no Coolify:", have.has("SUPABASE_SERVICE_ROLE_KEY") ? "sim" : "NÃO (precisa criar)")
for (const [key, value] of Object.entries(vars)) {
  if (!value) { console.error(`✗ ${key} está vazio no .env.deploy`); process.exit(1) }
  const body = { key, value, is_build_time: false, is_preview: false }
  const r = have.has(key) ? await api(`/applications/${COOLIFY_APP_UUID}/envs`, "PATCH", body) : await api(`/applications/${COOLIFY_APP_UUID}/envs`, "POST", body)
  console.log(r.ok ? `✓ ${key} ${have.has(key) ? "atualizada" : "criada"}` : `✗ ${key}: ${r.status} ${JSON.stringify(r.j).slice(0, 200)}`)
}
if (process.argv.includes("--deploy")) {
  const d = await api(`/deploy?uuid=${COOLIFY_APP_UUID}&force=false`)
  console.log(d.ok ? "✓ Deploy disparado no Coolify" : `✗ Deploy falhou: ${d.status} ${JSON.stringify(d.j).slice(0, 200)}`)
}
