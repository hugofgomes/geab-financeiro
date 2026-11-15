/** Datas e horários no FUSO DO ESTABELECIMENTO. Datas locais são textos "AAAA-MM-DD"; horários são minutos desde a meia-noite local. */

/** Deslocamento do fuso (minutos a leste de UTC) num instante. */
export function tzOffsetMin(tz: string, at: Date) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]))
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at.getTime()) / 60000)
}

/** Data local + minutos → instante UTC. */
export function zonedToUtc(tz: string, date: string, minutes: number) {
  const [y, m, d] = date.split("-").map(Number)
  const guess = Date.UTC(y, m - 1, d, 0, minutes)
  let t = guess - tzOffsetMin(tz, new Date(guess)) * 60000
  t = guess - tzOffsetMin(tz, new Date(t)) * 60000
  return new Date(t)
}

/** Instante → data local, minutos desde a meia-noite e dia da semana (0 = domingo). */
export function localParts(tz: string, at: Date | string) {
  const d = typeof at === "string" ? new Date(at) : at
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  const date = `${p.year}-${p.month}-${p.day}`
  return { date, minutes: +p.hour * 60 + +p.minute, dow: dowOf(date) }
}

export const todayIn = (tz: string) => localParts(tz, new Date()).date
export const dowOf = (date: string) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
export const addDays = (date: string, n: number) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }
export const startOfWeek = (date: string) => addDays(date, -dowOf(date))                    // semana começa no domingo
export const startOfMonth = (date: string) => date.slice(0, 8) + "01"
export const addMonths = (date: string, n: number) => { const [y, m] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10) }
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]
export const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
export const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]

export const fmtMinutes = (m: number) => `${String(Math.floor(m / 60) % 24 === 0 && m === 1440 ? 24 : Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
export const parseMinutes = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0) }
export const fmtDateBR = (date: string) => { const [y, m, d] = date.split("-"); return `${d}/${m}/${y}` }
export const fmtDateLong = (date: string) => { const [y, m, d] = date.split("-").map(Number); return `${WEEKDAYS[dowOf(date)]}, ${d} de ${MONTHS[m - 1].toLowerCase()} de ${y}` }
export const fmtRange = (tz: string, a: string, b: string) => { const x = localParts(tz, a), y = localParts(tz, b); return `${fmtMinutes(x.minutes)}–${fmtMinutes(y.date !== x.date ? 1440 : y.minutes)}` }
