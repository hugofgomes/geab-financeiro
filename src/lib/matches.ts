import type { Match } from "@/lib/types"

/** Data de hoje (AAAA-MM-DD) no fuso de Brasília, independente do relógio do aparelho. */
export function brToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function weekdayOf(iso: string) {
  return cap(new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`)))
}

export function monthNameOf(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`)).toUpperCase()
}

export const shortDate = (iso: string) => iso.split("-").reverse().join("/")
export const dayMonth = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7)
export const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null)

/** Vencedor do jogo: "a", "b" ou "empate". Só vale para jogos com placar. */
export function winnerOf(m: Pick<Match, "score_a" | "score_b">): "a" | "b" | "empate" | null {
  if (m.score_a == null || m.score_b == null) return null
  return m.score_a > m.score_b ? "a" : m.score_a < m.score_b ? "b" : "empate"
}

/** Cor do marcador da equipe, pelo nome (Azul, Branca, Vermelha…); neutro para os demais. */
export function teamDot(name: string) {
  const n = name.toLowerCase()
  if (n.includes("azul")) return "bg-blue-600"
  if (n.includes("branc")) return "bg-white ring-1 ring-slate-400"
  if (n.includes("vermelh")) return "bg-red-600"
  if (n.includes("verde")) return "bg-green-600"
  if (n.includes("amarel")) return "bg-yellow-400"
  if (n.includes("preta") || n.includes("preto")) return "bg-slate-900"
  return "bg-slate-400"
}

/** Separa a lista de jogos nas visões da barra lateral. */
export function splitMatches(all: Match[], today = brToday()) {
  const live = all.filter((m) => m.status === "em_andamento")
  const done = all.filter((m) => m.status === "finalizado")
    .sort((a, b) => (b.match_date + (b.match_time ?? "")).localeCompare(a.match_date + (a.match_time ?? "")))
  const next = all.filter((m) => m.status === "agendado" && m.match_date >= today)
    .sort((a, b) => (a.match_date + (a.match_time ?? "99")).localeCompare(b.match_date + (b.match_time ?? "99")))[0] ?? null
  return { live, last: done[0] ?? null, history: done.slice(1, 5), next }
}

/** Avisa a barra lateral que jogos mudaram (a Diretoria acabou de salvar). */
export const MATCHES_CHANGED = "geab:jogos"
