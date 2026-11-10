import { shortDate, hhmm } from "@/lib/matches"
import type { Match } from "@/lib/types"

export type LineupTeam = "a" | "b" | "reserva"
export type LineupEntry = { athlete_id: string; team: LineupTeam; is_keeper: boolean; shirt_number: string }
export type LineupAthlete = { id: string; full_name: string; nickname: string | null }

export const shownName = (a: Pick<LineupAthlete, "full_name" | "nickname">) => (a.nickname?.trim() || a.full_name.trim())

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
const firstWord = (t: string) => t.trim().split(/\s+/)[0] ?? ""

/** Nome do card: só o primeiro nome (ou o apelido, se houver). Repetidos ganham a inicial do sobrenome: "Lucas S.". */
export function cardLabels(list: LineupAthlete[]): Map<string, string> {
  const base = new Map(list.map((a) => [a.id, a.nickname?.trim() ? firstWord(a.nickname) : cap(firstWord(a.full_name))]))
  const count = new Map<string, number>()
  for (const n of base.values()) count.set(n.toLowerCase(), (count.get(n.toLowerCase()) ?? 0) + 1)
  const out = new Map<string, string>()
  for (const a of list) {
    const n = base.get(a.id)!
    const parts = a.full_name.trim().split(/\s+/)
    const last = parts.length > 1 ? parts[parts.length - 1] : ""
    out.set(a.id, (count.get(n.toLowerCase()) ?? 0) > 1 && last ? `${n} ${last.charAt(0).toUpperCase()}.` : n)
  }
  return out
}

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

export function whatsappMessage(m: Pick<Match, "match_date" | "match_time"> & { venue?: string | null }, orgName = "GEAB Futebol") {
  return [
    `⚽ *${orgName.toUpperCase()} — ESCALAÇÃO OFICIAL*`, "",
    "🔵 TIME AZUL x ⚪ TIME BRANCO", "",
    `📅 Data: ${shortDate(m.match_date)}`, "",
    `⏰ Horário: ${hhmm(m.match_time) ?? "a definir"}`, "",
    `📍 Local: ${m.venue?.trim() || "a definir"}`, "",
    `🔥 Mais um grande jogo do ${orgName}!`,
  ].join("\n")
}
