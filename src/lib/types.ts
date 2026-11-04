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
