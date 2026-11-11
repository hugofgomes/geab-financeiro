"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { APP_VERSION, CHANGELOG, RELEASE_DATE, fmtDate } from "@/lib/version"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import * as React from "react"

const SECTIONS = [["novidades", "Novidades"], ["melhorias", "Melhorias"], ["correcoes", "Correções"]] as const

/** Rodapé institucional: versão e data vêm de package.json + src/data/changelog.json. Clique na versão abre o histórico. */
export function AppFooter() {
  const [open, setOpen] = React.useState(false)
  // Registra o acesso do dia (uma chamada por aba/dia; o banco soma os acessos por usuário).
  React.useEffect(() => {
    if (!supabaseConfigured) return
    const key = `geab.acesso.${new Date().toISOString().slice(0, 10)}`
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1") } catch {}
    supabase().rpc("log_access", { p_ua: navigator.userAgent }).then(() => {}, () => {})
  }, [])
  const date = fmtDate(RELEASE_DATE)
  const year = RELEASE_DATE?.slice(0, 4)
  return (
    <footer className="mt-auto border-t bg-white px-4 py-4 text-xs text-muted-foreground">
      <p className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
        <span>GEAB Futebol{year ? ` © ${year}` : ""}</span>
        <span aria-hidden className="hidden sm:inline">|</span>
        <span>Sistema de Gestão Esportiva</span>
        <span aria-hidden className="hidden sm:inline">|</span>
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" title="Ver novidades e atualizações"
          className="rounded px-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Versão {APP_VERSION}</button>
        {date && <><span aria-hidden className="hidden sm:inline">|</span><span>Atualizado em {date}</span></>}
        <span aria-hidden className="hidden sm:inline">|</span>
        <span>Sistema desenvolvido por <a href="https://vendadigital.com" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">vendadigital</a></span>
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novidades e atualizações — GEAB Futebol</DialogTitle>
            <DialogDescription>Histórico de versões, da mais recente para a mais antiga.</DialogDescription>
          </DialogHeader>
          <ol className="space-y-6">
            {CHANGELOG.map((e) => (
              <li key={e.version} className="space-y-2">
                <h3 className="text-sm font-semibold text-primary">
                  Versão {e.version} — {e.date ? fmtDate(e.date) : e.title}
                  {e.version === APP_VERSION && <span className="ml-2 rounded-full bg-[#EF3028] px-2 py-0.5 text-[10px] font-semibold text-white">atual</span>}
                </h3>
                {e.date && <p className="text-xs text-muted-foreground">{e.title}</p>}
                {SECTIONS.map(([k, label]) => e[k].length > 0 && (
                  <div key={k}>
                    <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground">{e[k].map((t) => <li key={t}>{t}</li>)}</ul>
                  </div>
                ))}
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </footer>
  )
}
