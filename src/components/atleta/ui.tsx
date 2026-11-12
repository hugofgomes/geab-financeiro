"use client"

import type { DisplayStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { AlertTriangle, CheckCircle2, Clock3, Hourglass, type LucideIcon } from "lucide-react"
import * as React from "react"

export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase()
export const brief = (n: string) => n.replace(/^(equipe|time)\s+/i, "")

/** Avatar circular com as iniciais do atleta. */
export function AvatarAtleta({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full bg-[#2A5A8C] font-semibold text-white ring-2 ring-white/30",
      size === "sm" ? "size-8 text-xs" : size === "md" ? "size-10 text-sm" : "size-16 text-xl", className)}>{initials(name) || "?"}</span>
  )
}

const STATUS: Record<DisplayStatus, { label: string; cls: string; icon: LucideIcon }> = {
  pago: { label: "Pago", cls: "border-green-600/30 bg-green-600/10 text-green-800", icon: CheckCircle2 },
  pendente: { label: "Pendente", cls: "border-amber-500/40 bg-amber-100 text-amber-900", icon: Clock3 },
  parcial: { label: "Parcial", cls: "border-amber-500/40 bg-amber-100 text-amber-900", icon: Clock3 },
  atrasado: { label: "Vencido", cls: "border-[#EF3028]/30 bg-[#EF3028]/10 text-[#B4151B]", icon: AlertTriangle },
  em_conferencia: { label: "Em conferência", cls: "border-blue-600/30 bg-blue-100 text-blue-800", icon: Hourglass },
}

/** Situação da mensalidade: sempre texto + ícone + cor (nunca só a cor). */
export function StatusBadge({ status }: { status: DisplayStatus }) {
  const s = STATUS[status]
  return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", s.cls)}><s.icon className="size-3.5" aria-hidden />{s.label}</span>
}

/** Pequena etiqueta de situação do atleta (Ativo/Inativo). */
export function ActiveBadge({ active, onDark }: { active: boolean; onDark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
      active ? (onDark ? "bg-green-400/20 text-green-100" : "bg-green-600/10 text-green-800") : (onDark ? "bg-white/15 text-white/80" : "bg-slate-200 text-slate-700"))}>
      <span aria-hidden className={cn("size-1.5 rounded-full", active ? "bg-green-500" : "bg-slate-400")} />{active ? "Ativo" : "Inativo"}
    </span>
  )
}

/** Cartão base do dashboard: fundo branco, borda discreta, cantos arredondados e sombra suave. */
export function CardResumo({ title, icon: Icon, action, children, className, tone = "light" }: {
  title: string; icon?: LucideIcon; action?: React.ReactNode; children: React.ReactNode; className?: string; tone?: "light" | "brand"
}) {
  return (
    <section aria-label={title} className={cn("rounded-2xl border p-4 shadow-sm sm:p-5", tone === "brand" ? "border-transparent bg-gradient-to-br from-[#1E3A5F] to-[#2A5A8C] text-white" : "bg-card", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className={cn("flex items-center gap-2 text-xs font-semibold tracking-wide uppercase", tone === "brand" ? "text-white/80" : "text-muted-foreground")}>
          {Icon && <Icon className="size-4" aria-hidden />}{title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>
}

export function ErrorBox({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#EF3028]/30 bg-[#EF3028]/5 p-4 text-sm text-[#B4151B]">
      <span>{children}</span>
      {onRetry && <button type="button" onClick={onRetry} className="min-h-11 rounded-lg border border-[#EF3028]/40 bg-white px-4 font-medium hover:bg-[#EF3028]/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Tentar novamente</button>}
    </div>
  )
}
