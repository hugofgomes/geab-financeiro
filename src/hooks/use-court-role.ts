"use client"

import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import * as React from "react"

export type CourtRole = "admin" | "gerente" | "recepcionista" | "financeiro"

/** Perfil do usuário no módulo Quadra Esportiva (nulo = sem acesso ou módulo desligado no plano). `undefined` enquanto carrega. */
export function useCourtRole() {
  const [role, setRole] = React.useState<CourtRole | null | undefined>(undefined)
  React.useEffect(() => {
    if (!supabaseConfigured) { setRole(null); return }
    supabase().rpc("court_role").then((r) => setRole((r.data as CourtRole | null) ?? null), () => setRole(null))
  }, [])
  return role
}

export const SPORTS: [string, string][] = [["futebol_society", "Futebol society"], ["futsal", "Futsal"], ["futebol_campo", "Futebol de campo"], ["volei", "Vôlei"], ["volei_praia", "Vôlei de praia"], ["beach_tennis", "Beach tennis"], ["basquete", "Basquete"], ["tenis", "Tênis"], ["padel", "Padel"], ["outra", "Outra"]]
export const FLOORS: [string, string][] = [["grama_sintetica", "Grama sintética"], ["grama_natural", "Grama natural"], ["cimento", "Cimento"], ["madeira", "Madeira"], ["areia", "Areia"], ["saibro", "Saibro"], ["borracha", "Borracha"], ["outro", "Outro"]]
export const sportLabel = (v: string) => SPORTS.find(([k]) => k === v)?.[1] ?? v

export const CourtRoleCtx = React.createContext<CourtRole | null>(null)
/** Perfil já resolvido pelo layout do módulo. */
export const useCourtRoleCtx = () => React.useContext(CourtRoleCtx)
