import { serviceClient } from "@/lib/supabase/service"

/** Integração direta com o BTG Pactual Empresas (Pix Cobrança dinâmico). Fluxo OAuth 2.0 Authorization Code (BTG Id). */
const sandbox = () => (process.env.BTG_ENV || "production").toLowerCase() === "sandbox"
const idBase = () => (process.env.BTG_ID_BASE || (sandbox() ? "https://id.sandbox.btgpactual.com" : "https://id.btgpactual.com")).replace(/\/$/, "")
const apiBase = () => (process.env.BTG_API_BASE || (sandbox() ? "https://api.sandbox.empresas.btgpactual.com" : "https://api.empresas.btgpactual.com")).replace(/\/$/, "")
const company = () => (process.env.BTG_COMPANY_ID || "").replace(/\D/g, "")

export const BTG_SCOPE = "openid empresas.btgpactual.com/pix-cash-in"

export const btgConfigured = () =>
  !!(process.env.BTG_CLIENT_ID && process.env.BTG_CLIENT_SECRET && process.env.BTG_PIX_KEY && /^\d{14}$/.test(company()))

export function authorizeUrl(redirectUri: string, state: string) {
  const u = new URL(`${idBase()}/oauth2/authorize`)
  u.searchParams.set("client_id", process.env.BTG_CLIENT_ID!)
  u.searchParams.set("response_type", "code")
  u.searchParams.set("redirect_uri", redirectUri)
  u.searchParams.set("scope", BTG_SCOPE)
  u.searchParams.set("state", state)
  u.searchParams.set("prompt", "login")
  return u.toString()
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }

async function tokenRequest(form: Record<string, string>): Promise<Required<Pick<TokenResponse, "access_token">> & TokenResponse> {
  const basic = Buffer.from(`${process.env.BTG_CLIENT_ID}:${process.env.BTG_CLIENT_SECRET}`).toString("base64")
  const r = await fetch(`${idBase()}/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(20_000),
  })
  const raw = await r.text()
  let j: TokenResponse & { error?: string; error_description?: string } = {}
  try { j = JSON.parse(raw) } catch {}
  if (!r.ok || !j.access_token) throw new Error(`BTG Id recusou o pedido de acesso (${j.error_description || j.error || r.status})${r.ok ? "" : " " + raw.slice(0, 300)}.`)
  return j as Required<Pick<TokenResponse, "access_token">> & TokenResponse
}

async function saveTokens(t: TokenResponse & { access_token: string }, previousRefresh?: string, userId?: string) {
  const sb = serviceClient()
  if (!sb) throw new Error("Servidor sem chave de serviço configurada.")
  const refresh = t.refresh_token || previousRefresh
  if (!refresh) throw new Error("O BTG não devolveu o token de renovação.")
  const { error } = await sb.from("btg_connection").upsert({
    id: 1, access_token: t.access_token, refresh_token: refresh,
    expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    scope: t.scope ?? null, updated_at: new Date().toISOString(),
    ...(userId ? { connected_by: userId, connected_at: new Date().toISOString() } : {}),
  })
  if (error) throw new Error("Não foi possível guardar o acesso ao BTG.")
}

/** Troca o código de autorização pelos tokens e guarda no banco (só o servidor lê). */
export async function connectWithCode(code: string, redirectUri: string, userId: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri })
  await saveTokens(t, undefined, userId)
}

type Conn = { access_token: string; refresh_token: string; expires_at: string }
async function loadConn(): Promise<Conn | null> {
  const sb = serviceClient()
  if (!sb) return null
  const { data } = await sb.from("btg_connection").select("access_token, refresh_token, expires_at").eq("id", 1).maybeSingle()
  return (data as Conn | null) ?? null
}

export async function btgStatus(): Promise<{ connected: boolean; expiresAt?: string }> {
  const c = await loadConn()
  // O token de renovação vale 10 dias a cada uso; se o acesso venceu há mais que isso, é preciso reconectar.
  return c ? { connected: true, expiresAt: c.expires_at } : { connected: false }
}

async function accessToken(forceRefresh = false): Promise<string> {
  const c = await loadConn()
  if (!c) throw new Error("O BTG ainda não foi conectado. Use “Conectar BTG” em Mensalidades.")
  if (!forceRefresh && new Date(c.expires_at).getTime() - Date.now() > 300_000) return c.access_token
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: c.refresh_token })
  await saveTokens(t, c.refresh_token)
  return t.access_token
}

export type BtgCollection = { txId: string; id: string; emv: string | null; qrUrl: string | null }

/** Cria uma cobrança Pix dinâmica. `cents` em centavos (o BTG recebe o valor em reais). */
export async function createBtgCollection(p: { cents: number; displayText: string; expiresInSeconds: number; tags: Record<string, string> }): Promise<BtgCollection> {
  const call = async (token: string) => fetch(`${apiBase()}/v1/companies/${company()}/pix-cash-in/instant-collections`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      pixKey: process.env.BTG_PIX_KEY,
      amount: { original: Math.round(p.cents) / 100, allowCustomerChangeValue: false },
      displayText: p.displayText.slice(0, 100),
      expiresIn: p.expiresInSeconds,
      tags: p.tags,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  let r = await call(await accessToken())
  if (r.status === 401) r = await call(await accessToken(true)) // token pode ter sido invalidado: renova e tenta uma vez
  const j = (await r.json().catch(() => ({}))) as { txId?: string; id?: string; emv?: string; location?: { url?: string }; message?: string; error?: string }
  if (!r.ok) throw new Error(`BTG recusou a cobrança (${r.status}${j.message ? ": " + String(j.message).slice(0, 150) : j.error ? ": " + String(j.error).slice(0, 150) : ""}).`)
  if (!j.txId || !j.id) throw new Error("Resposta inesperada do BTG ao criar a cobrança.")
  return { txId: j.txId, id: j.id, emv: j.emv ?? null, qrUrl: j.location?.url ?? null }
}
