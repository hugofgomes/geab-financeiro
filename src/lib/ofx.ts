/** Leitura de extrato OFX (o formato que os bancos, inclusive o Itaú, exportam). Roda inteira no navegador. */
export type OfxTx = { fitid: string; date: string; amount: number; memo: string; type: string }

/** Decodifica o arquivo: UTF-8 e, se houver caracteres inválidos, Windows-1252 (comum em OFX brasileiro). */
export function decodeOfx(buf: ArrayBuffer): string {
  const utf = new TextDecoder("utf-8").decode(buf)
  if (!utf.includes("�")) return utf
  return new TextDecoder("windows-1252").decode(buf)
}

const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}>\\s*([^<\\r\\n]*)`, "i"))
  return m ? m[1].trim() : ""
}

/** Converte valor OFX ("1.234,56", "-100.00", "100,00") em número. */
export function parseAmount(raw: string): number {
  let s = raw.replace(/\s/g, "")
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "")
  else if (s.includes(",")) s = s.replace(",", ".")
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

/** Devolve só as transações com data, valor e identificador válidos (créditos e débitos). */
export function parseOfx(text: string): OfxTx[] {
  const out: OfxTx[] = []
  const blocks = text.split(/<STMTTRN>/i).slice(1)
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]
    const d = tag(block, "DTPOSTED").match(/^(\d{4})(\d{2})(\d{2})/)
    const amount = parseAmount(tag(block, "TRNAMT"))
    const fitid = tag(block, "FITID")
    if (!d || !Number.isFinite(amount) || !fitid) continue
    const memo = [tag(block, "NAME"), tag(block, "MEMO")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
    out.push({ fitid, date: `${d[1]}-${d[2]}-${d[3]}`, amount: Math.round(amount * 100) / 100, memo, type: tag(block, "TRNTYPE") })
  }
  return out
}
