import { fmtDateBR, localParts, fmtRange } from "@/lib/court-time"
import { formatBRL } from "@/lib/format"

export type Kind = "avulsa" | "mensalista" | "mensalista_professor" | "bloqueio"
export type Status = "pendente" | "confirmada" | "concluida" | "cancelada" | "nao_compareceu"
export type Booking = {
  id: string; court_id: string; code: string; kind: Kind; block_reason: "manutencao" | "torneio" | "outro" | null; client_name: string | null; client_phone: string | null; sport: string | null
  starts_at: string; ends_at: string; price_cents: number; payment_method: string | null; payment_status: "em_aberto" | "parcial" | "pago"; status: Status; notes: string | null
  series_id: string | null; occurrence_no: number | null; late_cancel: boolean; cancelled_at: string | null; cancel_reason: string | null; created_at: string
}
export type Court = { id: string; name: string; sport: string; active: boolean; price_cents: number }
export type Venue = { id: string; trade_name: string; timezone: string; slot_minutes: number; min_duration_minutes: number; min_notice_minutes: number; max_advance_days: number; cancel_free_hours: number; cancel_fee_pct: number }
export type Hours = { id: string; court_id: string | null; weekday: number; opens_min: number; closes_min: number; active: boolean }

export const KIND_LABEL: Record<Kind, string> = { avulsa: "Reserva avulsa", mensalista: "Mensalista", mensalista_professor: "Mensalista com professor", bloqueio: "Bloqueio" }
/** Cores da agenda (legenda): laranja = avulsa, verde = mensalista, roxo = mensalista com professor, cinza = bloqueios/manutenção. */
export const KIND_STYLE: Record<Kind, { box: string; dot: string }> = {
  avulsa: { box: "border-orange-400 bg-orange-100 text-orange-950", dot: "bg-orange-400" },
  mensalista: { box: "border-green-500 bg-green-100 text-green-950", dot: "bg-green-500" },
  mensalista_professor: { box: "border-purple-500 bg-purple-100 text-purple-950", dot: "bg-purple-500" },
  bloqueio: { box: "border-slate-400 bg-slate-200 text-slate-800", dot: "bg-slate-400" },
}
export const STATUS_LABEL: Record<Status, string> = { pendente: "Pendente", confirmada: "Confirmada", concluida: "Concluída", cancelada: "Cancelada", nao_compareceu: "Não compareceu" }
export const PAY_STATUS_LABEL = { em_aberto: "Em aberto", parcial: "Parcialmente pago", pago: "Pago" } as const
export const PAY_METHODS: [string, string][] = [["dinheiro", "Dinheiro"], ["pix", "Pix"], ["cartao_credito", "Cartão de crédito"], ["cartao_debito", "Cartão de débito"], ["transferencia", "Transferência"], ["outro", "Outro"]]
export const BLOCK_REASON: Record<string, string> = { manutencao: "Manutenção", torneio: "Torneio", outro: "Outro motivo" }

export const bookingTitle = (b: Booking) => (b.kind === "bloqueio" ? `Bloqueio · ${BLOCK_REASON[b.block_reason ?? "outro"]}` : b.client_name ?? "Reserva")

/** Mensagem pronta para o WhatsApp do cliente. */
export function whatsappLink(b: Booking, courtName: string, tz: string, venueName: string) {
  const phone = (b.client_phone ?? "").replace(/\D/g, "")
  const s = localParts(tz, b.starts_at)
  const msg = `Olá, ${b.client_name ?? ""}! Sua reserva ${b.code} na ${courtName} (${venueName}) está ${STATUS_LABEL[b.status].toLowerCase()}: ${fmtDateBR(s.date)}, ${fmtRange(tz, b.starts_at, b.ends_at)}. Valor: ${formatBRL(b.price_cents / 100)}.`
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
}

/** Distribui blocos que se sobrepõem em colunas lado a lado (quando várias quadras aparecem na mesma coluna). */
export function layoutLanes<T extends { s: number; e: number }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.s - b.s || a.e - b.e)
  const lanes: number[] = []
  const out = new Map<T, { lane: number; of: number }>()
  const groups: T[][] = []
  let cur: T[] = [], curEnd = -1
  for (const it of sorted) {
    if (cur.length && it.s >= curEnd) { groups.push(cur); cur = []; curEnd = -1; lanes.length = 0 }
    let lane = lanes.findIndex((end) => end <= it.s)
    if (lane === -1) { lane = lanes.length; lanes.push(it.e) } else lanes[lane] = it.e
    cur.push(it); curEnd = Math.max(curEnd, it.e); out.set(it, { lane, of: 1 })
  }
  if (cur.length) groups.push(cur)
  for (const g of groups) { const n = Math.max(...g.map((x) => out.get(x)!.lane)) + 1; for (const x of g) out.get(x)!.of = n }
  return out
}
