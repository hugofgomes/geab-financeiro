export interface Athlete {
  id: string
  full_name: string
  nickname: string | null
  phone: string | null
  email: string | null
  cpf: string | null
  monthly_fee: number
  due_day: number
  active: boolean
  whatsapp_consent: boolean
  birth_date: string | null
  joined_at: string
}

export type DisplayStatus = "pendente" | "parcial" | "pago" | "em_conferencia" | "atrasado"

export interface Charge {
  id: string
  athlete_id: string
  competence: string
  due_date: string
  amount: number
  status: string
  paid_total: number
  balance: number
  display_status: DisplayStatus
}

export interface Payment {
  id: string
  athlete_id: string
  charge_id: string
  amount: number
  paid_at: string
  method: "pix" | "dinheiro" | "transferencia" | "outro"
  source: "manual" | "extrato" | "pix_webhook"
  notes: string | null
}

export interface Expense {
  id: string
  spent_at: string
  description: string
  category: string | null
  location: string | null
  amount: number
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  pendente: "Pendente",
  parcial: "Parcialmente pago",
  pago: "Pago",
  em_conferencia: "Em conferência",
  atrasado: "Atrasado",
}

export type SignupRequest = {
  id: string
  user_id: string
  email: string
  full_name: string
  nickname: string | null
  phone: string | null
  whatsapp_consent: boolean
  birth_date: string | null
  status: "pendente" | "aprovado" | "recusado"
  athlete_id: string | null
  created_at: string
  decided_at: string | null
}

export type MatchStatus = "agendado" | "em_andamento" | "finalizado"
export type Match = {
  id: string
  match_date: string
  match_time: string | null
  team_a: string
  team_b: string
  score_a: number | null
  score_b: number | null
  status: MatchStatus
  venue?: string | null // migration 0015
  lineup_confirmed?: boolean // migration 0015
}
export type MonthBirthday = { display_name: string; bday: number; bmonth: number; turning_age: number; is_today: boolean }

export type Scorer = { athlete_id: string; display_name: string; goals: number; games: number; pos: number }
export type ScorerStats = {
  name: string
  season: number
  goals: number
  games: number
  avg: number
  month_goals: number | null
  position: number | null
  history: { date: string; team_a: string; team_b: string; score_a: number | null; score_b: number | null; goals: number }[]
}

export type PixCharge = {
  id: string
  charge_id: string
  athlete_id: string
  status: "ativa" | "paga" | "divergente" | "conferir"
  br_code: string | null
  payment_link: string | null
  qr_image: string | null
  expires_at: string | null
  review: boolean
  note: string | null
  value_cents: number
  created_at: string
}
