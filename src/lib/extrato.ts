/** Casamento entre créditos do extrato e atletas/mensalidades. Só propõe: quem confirma é a Diretoria. */
export type AthleteLite = { id: string; full_name: string; nickname: string | null; active: boolean }
export type OpenCharge = { id: string; athlete_id: string; competence: string; balance: number }

const PARTICLES = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"])
const NOISE = new Set(["PIX", "TRANSF", "TRANSFERENCIA", "RECEBIDO", "RECEBIDA", "RECEBIDOS", "QRS", "QR", "CODE", "TED", "DOC", "CREDITO", "DEP", "DEPOSITO", "REM", "REMETENTE", "PAGAMENTO", "PAG", "ITAU", "UNIBANCO", "BCO", "BANCO", "CONTA", "CPF", "CNPJ", "EM", "AG", "OUTROS", "BANCOS"])

export const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim()

const tokens = (s: string, drop: Set<string>) => norm(s).split(" ").filter((t) => t && !drop.has(t))

/** Quantos nomes do atleta aparecem na descrição. O banco costuma truncar nomes longos, então aceita prefixo (≥4 letras). */
function matchedTokens(memo: string[], athlete: string[]) {
  let n = 0
  for (const a of athlete) if (memo.some((m) => m === a || (m.length >= 4 && a.startsWith(m)) || (a.length >= 4 && m.startsWith(a)))) n++
  return n
}

export type Guess = { athlete: AthleteLite | null; certain: boolean }

/**
 * Procura o atleta cujo nome aparece na descrição. "certain" só quando um único atleta atinge o
 * melhor resultado com pelo menos 2 nomes iguais (ou o nome inteiro, se tiver só um). Qualquer dúvida vira conferência manual.
 */
export function guessAthlete(memo: string, athletes: AthleteLite[]): Guess {
  const m = tokens(memo, NOISE)
  if (!m.length) return { athlete: null, certain: false }
  const scored = athletes.map((a) => {
    const t = tokens(a.full_name, PARTICLES)
    const hit = matchedTokens(m, t)
    return { a, hit, total: t.length, full: t.length > 0 && hit === t.length }
  }).filter((x) => x.hit > 0).sort((x, y) => y.hit - x.hit || Number(y.full) - Number(x.full) || Number(y.a.active) - Number(x.a.active))
  if (!scored.length) return { athlete: null, certain: false }
  const best = scored[0]
  const tie = scored.filter((x) => x.hit === best.hit)
  const strong = best.hit >= 2 || (best.total === 1 && best.full)
  // atleta inativo nunca é "certo": pagamento de quem saiu merece olhar humano
  return { athlete: best.a, certain: tie.length === 1 && strong && best.a.active }
}

/** Mensalidade em aberto mais antiga que comporta o valor pago. */
export function pickCharge(charges: OpenCharge[], athleteId: string, amount: number): OpenCharge | null {
  const mine = charges.filter((c) => c.athlete_id === athleteId && c.balance > 0.004).sort((a, b) => a.competence.localeCompare(b.competence))
  return mine.find((c) => c.balance + 0.004 >= amount) ?? null
}
