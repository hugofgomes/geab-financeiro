import { shortDate, hhmm } from "@/lib/matches"
import type { Match } from "@/lib/types"

export type LineupTeam = "a" | "b" | "reserva"
export type LineupEntry = { athlete_id: string; team: LineupTeam; is_keeper: boolean; shirt_number: string }
export type LineupAthlete = { id: string; full_name: string; nickname: string | null }

export const shownName = (a: Pick<LineupAthlete, "full_name" | "nickname">) => (a.nickname?.trim() || a.full_name.trim())

/** Embaralha (Fisher-Yates) sem mexer na lista original. */
function shuffle<T>(list: T[]) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** Distribui os atletas entre Azul e Branco: goleiros primeiro (um para cada lado), depois alterna mantendo o equilíbrio. */
export function autoDistribute(ids: string[], keepers: Set<string>, base: LineupEntry[]): LineupEntry[] {
  const out = [...base]
  const count = (t: LineupTeam) => out.filter((e) => e.team === t).length
  const ordered = [...shuffle(ids.filter((i) => keepers.has(i))), ...shuffle(ids.filter((i) => !keepers.has(i)))]
  for (const id of ordered) {
    const team: LineupTeam = count("a") <= count("b") ? "a" : "b"
    out.push({ athlete_id: id, team, is_keeper: keepers.has(id), shirt_number: "" })
  }
  return out
}

export function whatsappMessage(m: Pick<Match, "match_date" | "match_time"> & { venue?: string | null }) {
  return [
    "⚽ *GEAB FUTEBOL — ESCALAÇÃO OFICIAL*", "",
    "🔵 TIME AZUL x ⚪ TIME BRANCO", "",
    `📅 Data: ${shortDate(m.match_date)}`, "",
    `⏰ Horário: ${hhmm(m.match_time) ?? "a definir"}`, "",
    `📍 Local: ${m.venue?.trim() || "a definir"}`, "",
    "🔥 Mais um grande jogo do GEAB!",
  ].join("\n")
}
