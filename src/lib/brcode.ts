/** Pix "copia e cola" (BR Code / EMV). Lê o código estático da Diretoria e gera o código com o valor de cada mensalidade. */
type Tlv = { id: string; value: string }

export function parseTlv(s: string): Tlv[] | null {
  const out: Tlv[] = []
  let i = 0
  while (i < s.length) {
    if (i + 4 > s.length) return null
    const id = s.slice(i, i + 2), len = Number(s.slice(i + 2, i + 4))
    if (!/^\d{2}$/.test(id) || !Number.isInteger(len) || !/^\d{2}$/.test(s.slice(i + 2, i + 4))) return null
    if (i + 4 + len > s.length) return null
    out.push({ id, value: s.slice(i + 4, i + 4 + len) })
    i += 4 + len
  }
  return out
}

/** CRC16-CCITT (poly 0x1021, início 0xFFFF), 4 hex maiúsculos. */
export function crc16(s: string): string {
  let crc = 0xffff
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, "0")
}

const tlv = (id: string, v: string) => id + String(v.length).padStart(2, "0") + v

export type PixInfo = { key: string; name: string; city: string; amount: number | null; txid: string | null; message: string | null }

/** Confere o formato e o CRC e devolve os dados principais; `null` se não for um Pix copia e cola válido. */
export function inspectBrCode(raw: string): PixInfo | null {
  const code = raw.trim()
  if (!code.startsWith("000201") || code.length < 40 || code.length > 600) return null
  const top = parseTlv(code)
  if (!top || top.at(-1)?.id !== "63" || top.at(-1)?.value.length !== 4) return null
  if (crc16(code.slice(0, -4)) !== top.at(-1)!.value.toUpperCase()) return null
  const acct = top.find((t) => t.id === "26")
  const sub = acct ? parseTlv(acct.value) : null
  if (!sub || sub.find((t) => t.id === "00")?.value.toLowerCase() !== "br.gov.bcb.pix") return null
  const get = (id: string) => top.find((t) => t.id === id)?.value
  const amount = get("54")
  const extra = get("62") ? parseTlv(get("62")!) : null
  return {
    key: sub.find((t) => t.id === "01")?.value ?? "",
    message: sub.find((t) => t.id === "02")?.value ?? null,
    name: get("59") ?? "", city: get("60") ?? "",
    amount: amount ? Number(amount) : null,
    txid: extra?.find((t) => t.id === "05")?.value ?? null,
  }
}

/** Gera o código com o valor informado (centavos) e um identificador próprio; mantém chave, nome, cidade e mensagem. */
export function brCodeForAmount(raw: string, cents: number, txid: string): string | null {
  if (!inspectBrCode(raw) || !Number.isInteger(cents) || cents <= 0 || cents > 99_999_999) return null
  const clean = txid.replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***"
  const top = parseTlv(raw.trim())!.filter((t) => !["54", "62", "63"].includes(t.id))
  top.push({ id: "54", value: (cents / 100).toFixed(2) }, { id: "62", value: tlv("05", clean) })
  top.sort((a, b) => Number(a.id) - Number(b.id))
  const body = top.map((t) => tlv(t.id, t.value)).join("") + "6304"
  return body + crc16(body)
}
