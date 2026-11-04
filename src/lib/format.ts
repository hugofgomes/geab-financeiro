const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
export const formatBRL = (v: number) => brl.format(v)

/** "2025-06-10" → "10/06/2025" sem passar por Date (evita erro de fuso). */
export const formatDate = (iso: string) => iso.split("-").reverse().join("/")

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
/** "2025-06-01" → "junho/2025" */
export const formatCompetence = (iso: string) => {
  const [y, m] = iso.split("-")
  return `${MONTHS[Number(m) - 1]}/${y}`
}
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
export const addMonths = (key: string, n: number) => {
  const [y, m] = key.split("-").map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return monthKey(d)
}
export const digits = (s: string) => s.replace(/\D/g, "")
