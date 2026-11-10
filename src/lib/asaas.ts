/** Cliente mínimo do Asaas (cobrança recorrente: Pix, boleto e cartão). Só roda no servidor. */
const BASE = () => (process.env.ASAAS_ENV === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3")

export const asaasConfigured = () => !!process.env.ASAAS_API_KEY && !!process.env.ASAAS_WEBHOOK_TOKEN

export async function asaas<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(BASE() + path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", access_token: process.env.ASAAS_API_KEY!, "user-agent": "geab-futebol" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  const json = (await res.json().catch(() => ({}))) as { errors?: { description?: string }[] }
  if (!res.ok) throw new Error(json.errors?.[0]?.description || `Asaas respondeu ${res.status}`)
  return json as T
}

export const onlyDigits = (s: string) => s.replace(/\D/g, "")

/** CPF (11) ou CNPJ (14) com dígitos verificadores corretos. */
export function validCpfCnpj(raw: string) {
  const d = onlyDigits(raw)
  if (/^(\d)\1+$/.test(d)) return false
  const dv = (base: string, w: number[]) => { const s = base.split("").reduce((a, c, i) => a + Number(c) * w[i], 0) % 11; return s < 2 ? 0 : 11 - s }
  if (d.length === 11) return dv(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[9] && dv(d.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[10]
  if (d.length === 14) return dv(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[12] && dv(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[13]
  return false
}
