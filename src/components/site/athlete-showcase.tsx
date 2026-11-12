"use client"

import { Laptop, Phone } from "@/components/site/mockups"
import { cn } from "@/lib/utils"
import Image from "next/image"
import * as React from "react"

const TABS = [
  { id: "geral", label: "Visão geral", src: "/site/atleta-geral.webp", alt: "Visão geral da área do atleta: próximo jogo, mensalidade, desempenho, último jogo e artilharia" },
  { id: "jogos", label: "Jogos", src: "/site/atleta-jogos.webp", alt: "Aba Jogos da área do atleta: histórico de jogos e gols do atleta" },
  { id: "financeiro", label: "Financeiro", src: "/site/atleta-financeiro.webp", alt: "Aba Financeiro da área do atleta: mensalidades e histórico de pagamentos" },
  { id: "perfil", label: "Perfil", src: "/site/atleta-perfil.webp", alt: "Aba Perfil da área do atleta: dados pessoais e configurações da conta" },
] as const

/** Telas reais da área do atleta (dados fictícios), com abas para alternar entre elas. */
export function AthleteShowcase() {
  const [i, setI] = React.useState(0)
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
    e.preventDefault()
    const n = (i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length
    setI(n)
    document.getElementById(`atl-tab-${TABS[n].id}`)?.focus()
  }
  return (
    <div className="relative pb-6 sm:pr-14">
      <div role="tablist" aria-label="Telas da área do atleta" onKeyDown={onKey} className="mb-5 flex flex-wrap justify-center gap-2 sm:justify-start">
        {TABS.map((t, k) => (
          <button key={t.id} id={`atl-tab-${t.id}`} role="tab" type="button" aria-selected={i === k} aria-controls="atl-panel" tabIndex={i === k ? 0 : -1} onClick={() => setI(k)}
            className={cn("rounded-full px-4 py-2 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[#0057B8]/50",
              i === k ? "bg-[#0057B8] text-white shadow-[0_8px_24px_-10px_rgba(0,87,184,.7)]" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-[#17365D]")}>
            {t.label}
          </button>
        ))}
      </div>
      <div id="atl-panel" role="tabpanel" aria-labelledby={`atl-tab-${TABS[i].id}`}>
        <Laptop label="Área do atleta no computador (dados ilustrativos)">
          <Image key={TABS[i].src} src={TABS[i].src} alt={TABS[i].alt} width={1920} height={1200} sizes="(min-width: 1024px) 640px, 100vw" className="h-full w-full object-cover" />
        </Laptop>
      </div>
      <Phone label="Área do atleta no celular (dados ilustrativos)" className="absolute -right-1 -bottom-2 hidden w-[24%] min-w-24 sm:block">
        <Image src="/site/atleta-celular.webp" alt="Área do atleta no celular, com o próximo jogo e a mensalidade" width={900} height={1600} sizes="160px" className="h-full w-full object-cover object-top" />
      </Phone>
    </div>
  )
}
