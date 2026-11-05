import { createVerify } from "node:crypto"

export const openpixConfigured = () => !!process.env.OPENPIX_APP_ID
const base = () => (process.env.OPENPIX_API_BASE || "https://api.openpix.com.br").replace(/\/$/, "")

export type PixCharge = { correlationID: string; brCode: string | null; paymentLinkUrl: string | null; qrCodeImage: string | null }

/** Cria uma cobrança Pix dinâmica. `value` em centavos. */
export async function createPixCharge(p: { correlationID: string; valueCents: number; comment: string; customerName: string; expiresInSeconds: number }): Promise<PixCharge> {
  const r = await fetch(`${base()}/api/v1/charge?return_existing=true`, {
    method: "POST",
    headers: { Authorization: process.env.OPENPIX_APP_ID!, "Content-Type": "application/json" },
    body: JSON.stringify({
      correlationID: p.correlationID, value: p.valueCents, comment: p.comment.slice(0, 140),
      expiresIn: p.expiresInSeconds, customer: { name: p.customerName.slice(0, 100) },
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const j = (await r.json().catch(() => ({}))) as { charge?: Partial<PixCharge>; brCode?: string; error?: string; message?: string }
  if (!r.ok) throw new Error((j.error || j.message || `Erro ${r.status} no OpenPix`).toString().slice(0, 200))
  const c = j.charge ?? {}
  return { correlationID: c.correlationID ?? p.correlationID, brCode: c.brCode ?? j.brCode ?? null, paymentLinkUrl: c.paymentLinkUrl ?? null, qrCodeImage: c.qrCodeImage ?? null }
}

// ───────── Assinatura dos webhooks (RSA-SHA256, chave pública do OpenPix) ─────────
let keyCache: { keys: string[]; at: number } | null = null

async function publicKeys(): Promise<string[]> {
  if (keyCache && Date.now() - keyCache.at < 3_600_000) return keyCache.keys
  try {
    const r = await fetch(`${base()}/api/v1/webhook/public-keys`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) throw new Error(String(r.status))
    const j = (await r.json()) as { public_keys?: { key?: string }[] }
    const keys = (j.public_keys ?? []).map((k) => k.key).filter((k): k is string => !!k)
    if (!keys.length) throw new Error("sem chaves")
    keyCache = { keys, at: Date.now() }
    return keys
  } catch (e) {
    if (keyCache) return keyCache.keys // usa a última versão conhecida
    throw e
  }
}

/** Confere se o corpo BRUTO do webhook foi assinado pelo OpenPix. Qualquer chave da lista vale (rotação). */
export async function verifyWebhook(rawBody: string, signatureB64: string | null): Promise<boolean> {
  if (!signatureB64) return false
  const keys = await publicKeys()
  return keys.some((pem) => {
    try { return createVerify("sha256").update(rawBody).end().verify(pem, signatureB64, "base64") } catch { return false }
  })
}
