/** Data local de hoje no formato AAAA-MM-DD (o aniversário vale no dia do navegador de quem usa). */
export function todayISO(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** É aniversário em `today`? Quem nasceu em 29/02 comemora em 28/02 nos anos não bissextos. */
export function isBirthday(birth: string | null | undefined, today = todayISO()) {
  if (!birth || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return false
  const [by, bm, bd] = birth.split("-").map(Number)
  const [ty, tm, td] = today.split("-").map(Number)
  if (by > ty) return false
  if (bm === 2 && bd === 29 && !isLeap(ty)) return tm === 2 && td === 28
  return bm === tm && bd === td
}

/** Evita mostrar o cartão mais de uma vez no mesmo dia no mesmo navegador. */
export function seenToday(key: string) {
  try { return localStorage.getItem(`geab.aniv.${key}`) === todayISO() } catch { return false }
}
export function markSeen(key: string) {
  try { localStorage.setItem(`geab.aniv.${key}`, todayISO()) } catch { /* navegador sem armazenamento */ }
}
