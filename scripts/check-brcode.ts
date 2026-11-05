import { brCodeForAmount, crc16, inspectBrCode } from "../src/lib/brcode"
let bad = 0
const t = (n: string, c: boolean, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : x); if (!c) bad++ }
// Código real do Pix estático enviado pela Diretoria (valor R$ 100,00)
const REAL = "00020126710014br.gov.bcb.pix0121geabfutebol@gmail.com0224Obrigado pelo pagamento 5204000053039865406100.005802BR592523.792.018 HUGO FERNANDO 6002NA62290525143301663f6d42GeabFutebol63048FDA"
const i = inspectBrCode(REAL)
t("código real é válido (CRC confere)", !!i)
t("lê chave, mensagem, valor, nome, cidade e txid", i?.key === "geabfutebol@gmail.com" && i.message === "Obrigado pelo pagamento " && i.amount === 100 && i.name === "23.792.018 HUGO FERNANDO " && i.city === "NA" && i.txid === "143301663f6d42GeabFutebol", JSON.stringify(i))
t("reconstruir com o mesmo valor e txid reproduz o código original byte a byte", brCodeForAmount(REAL, 10000, "143301663f6d42GeabFutebol") === REAL, String(brCodeForAmount(REAL, 10000, "143301663f6d42GeabFutebol")))
const c150 = brCodeForAmount(REAL, 15050, "GEAB1234ABCD")!
const j = inspectBrCode(c150)
t("novo valor R$ 150,50 gera código válido com o mesmo recebedor", j?.amount === 150.5 && j.key === "geabfutebol@gmail.com" && j.txid === "GEAB1234ABCD" && j.name === i?.name)
t("sem o campo de valor também funciona (QR aberto vira valor fixo)", (() => { const open = REAL.replace("5406100.00", ""); const fixed = (c: string) => { const b = c.slice(0, -4); return b + crc16(b) }; const o = fixed(open); return inspectBrCode(o)?.amount === null && inspectBrCode(brCodeForAmount(o, 10000, "X1")!)?.amount === 100 })())
t("CRC errado é recusado", inspectBrCode(REAL.slice(0, -4) + "0000") === null)
t("texto qualquer é recusado", inspectBrCode("oi") === null && inspectBrCode("") === null && inspectBrCode("00020126" + "x".repeat(60)) === null)
t("não é Pix (sem br.gov.bcb.pix) é recusado", (() => { const b = REAL.slice(0, -4).replace("br.gov.bcb.pix", "br.gov.bcb.xxx"); return inspectBrCode(b + crc16(b)) === null })())
t("valor zero, negativo ou absurdo é recusado", brCodeForAmount(REAL, 0, "A") === null && brCodeForAmount(REAL, -5, "A") === null && brCodeForAmount(REAL, 1e12, "A") === null && brCodeForAmount(REAL, 1.5, "A") === null)
t("txid é limpo para letras e números, até 25", inspectBrCode(brCodeForAmount(REAL, 100, "GEAB-ab_cd 12345678901234567890123456789")!)?.txid === "GEABabcd12345678901234567")
t("CRC de referência (padrão CCITT-FALSE)", crc16("123456789") === "29B1")
process.exit(bad ? 1 : 0)
