"use client"

import { cn } from "@/lib/utils"
import { ArrowRight, Menu, X } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

const NAV: [string, string][] = [["Início", "/site#inicio"], ["Funcionalidades", "/site#funcionalidades"], ["Jogos", "/site#jogos"], ["Financeiro", "/site#financeiro"], ["Área do Atleta", "/site#atleta"], ["Planos", "/site#planos"]]
const GREEN = "#39FF14"

function Logo({ dark }: { dark: boolean }) {
  return <Link href="/site" className={cn("font-[family-name:var(--font-sora)] text-lg font-bold tracking-tight", dark ? "text-white" : "text-[#17365D]")}>GEAB <span className={cn("font-normal", dark ? "text-[#39FF14]" : "text-[#0057B8]")}>Futebol</span></Link>
}

/** Cabeçalho escuro fixo: transparente no topo, sólido depois da rolagem; no celular, menu hambúrguer com animação. */
function DarkHeader() {
  const [open, setOpen] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)
  React.useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24)
    on(); window.addEventListener("scroll", on, { passive: true })
    return () => window.removeEventListener("scroll", on)
  }, [])
  React.useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [open])
  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 transition-colors duration-300", scrolled || open ? "border-b border-white/10 bg-[#080D0B]/90 backdrop-blur-md" : "bg-transparent")}>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5">
        <Logo dark />
        <nav aria-label="Principal" className="hidden items-center gap-6 text-sm lg:flex">
          {NAV.map(([t, h]) => <a key={t} href={h} className="text-[#AAB4AE] transition-colors hover:text-white">{t}</a>)}
        </nav>
        <div className="hidden items-center gap-4 lg:flex">
          <Link href="/login" className="text-sm font-medium text-white/90 transition-colors hover:text-[#39FF14]">Entrar</Link>
          <Link href="/novo-grupo" className="rounded-full bg-[#39FF14] px-5 py-2.5 text-sm font-bold tracking-wide text-[#04130B] transition hover:-translate-y-px hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none">TESTAR GRÁTIS</Link>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="menu-mobile" aria-label={open ? "Fechar menu" : "Abrir menu"}
          className="grid size-11 place-items-center rounded-lg text-white transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#39FF14] focus-visible:outline-none lg:hidden">
          <span className="relative block size-6">
            <Menu className={cn("absolute inset-0 size-6 transition-all duration-300", open ? "rotate-90 scale-50 opacity-0" : "rotate-0 opacity-100")} />
            <X className={cn("absolute inset-0 size-6 transition-all duration-300", open ? "rotate-0 opacity-100" : "-rotate-90 scale-50 opacity-0")} />
          </span>
        </button>
      </div>
      <div id="menu-mobile" className={cn("grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out lg:hidden", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")} aria-hidden={!open}>
        <div className="min-h-0">
          <nav aria-label="Menu móvel" className="mx-auto max-w-7xl space-y-1 px-5 pt-1 pb-5">
            {NAV.map(([t, h]) => <a key={t} href={h} tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 text-base text-white/90 hover:bg-white/5">{t}</a>)}
            <Link href="/login" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 text-base text-white/90 hover:bg-white/5">Entrar</Link>
            <Link href="/novo-grupo" tabIndex={open ? 0 : -1} className="mt-2 flex items-center justify-center gap-2 rounded-full bg-[#39FF14] px-5 py-3.5 text-sm font-bold tracking-wide text-[#04130B]">TESTAR GRÁTIS <ArrowRight className="size-4" /></Link>
          </nav>
        </div>
      </div>
    </header>
  )
}

function DarkFooter({ version }: { version: string }) {
  const year = new Date().getFullYear()
  const col = "space-y-2.5 text-sm text-[#AAB4AE]"
  const a = "transition-colors hover:text-[#39FF14]"
  return (
    <footer className="border-t border-white/10 bg-[#050806] pt-14 pb-8 text-[#AAB4AE]">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo dark />
          <p className="max-w-xs text-sm leading-relaxed">Plataforma para organizar o seu grupo de futebol: atletas, jogos, escalações, mensalidades e estatísticas em um só lugar.</p>
        </div>
        <div><h2 className="mb-3 text-sm font-semibold tracking-wide text-white">Plataforma</h2>
          <ul className={col}>
            <li><a href="/site#funcionalidades" className={a}>Funcionalidades</a></li><li><a href="/site#jogos" className={a}>Jogos e escalação</a></li>
            <li><a href="/site#financeiro" className={a}>Financeiro</a></li><li><a href="/site#atleta" className={a}>Área do atleta</a></li></ul></div>
        <div><h2 className="mb-3 text-sm font-semibold tracking-wide text-white">Começar</h2>
          <ul className={col}>
            <li><a href="/site#planos" className={a}>Planos e preços</a></li><li><Link href="/novo-grupo" className={a}>Criar conta grátis</Link></li>
            <li><Link href="/demo" className={a}>Demonstração</Link></li><li><Link href="/login" className={a}>Acessar o sistema</Link></li></ul></div>
        <div><h2 className="mb-3 text-sm font-semibold tracking-wide text-white">Legal</h2>
          <ul className={col}><li><Link href="/privacidade" className={a}>Política de privacidade</Link></li><li><Link href="/termos" className={a}>Termos de uso</Link></li></ul></div>
      </div>
      <div className="mx-auto mt-10 flex max-w-7xl flex-col items-center justify-between gap-2 border-t border-white/10 px-5 pt-6 text-xs sm:flex-row">
        <span>© {year} GEAB Futebol. Todos os direitos reservados.</span>
        <span>Versão {version} · Sistema desenvolvido por <a href="https://vendadigital.com" target="_blank" rel="noreferrer" className={a}>vendadigital</a></span>
      </div>
    </footer>
  )
}

/** Páginas do site em tema escuro (esportivo); a demonstração mantém o tema claro. */
export function SiteChrome({ children, version }: { children: React.ReactNode; version: string }) {
  const path = usePathname()
  if (path.startsWith("/demo")) return <LightChrome>{children}</LightChrome>
  return (
    <div className="min-h-dvh overflow-x-clip bg-[#080D0B] text-[#AAB4AE]" style={{ ["--neon" as string]: GREEN }}>
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-black">Pular para o conteúdo</a>
      <DarkHeader />
      <main id="conteudo">{children}</main>
      <DarkFooter version={version} />
    </div>
  )
}

const LIGHT_LINKS = [["Recursos", "/site#funcionalidades"], ["Jogos", "/site#jogos"], ["Financeiro", "/site#financeiro"], ["Planos", "/site#planos"]]

function LightChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh overflow-x-clip bg-white text-slate-700 [--site-blue:#0057B8] [--site-navy:#17365D]">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <Logo dark={false} />
          <nav aria-label="Principal" className="hidden items-center gap-7 text-sm md:flex">
            {LIGHT_LINKS.map(([t, h]) => <a key={t} href={h} className="text-slate-600 transition-colors hover:text-[#0057B8]">{t}</a>)}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <Link href="/login" className="text-sm text-slate-600 transition-colors hover:text-[#0057B8]">Entrar</Link>
            <Link href="/site" className="text-sm text-slate-600 transition-colors hover:text-[#0057B8]">Voltar ao site</Link>
            <Link href="/novo-grupo" className="rounded-full bg-[#0057B8] px-5 py-2 text-sm font-medium text-white transition hover:-translate-y-px hover:bg-[#004a9e]">Criar conta grátis</Link>
          </div>
          <details className="group relative md:hidden">
            <summary aria-label="Abrir menu" className="grid size-10 cursor-pointer list-none place-items-center rounded-lg text-[#17365D] [&::-webkit-details-marker]:hidden"><Menu className="size-6" /></summary>
            <div className="absolute right-0 mt-2 w-64 space-y-1 rounded-2xl border border-slate-100 bg-white p-3 shadow-xl">
              {LIGHT_LINKS.map(([t, h]) => <a key={t} href={h} className="block rounded-lg px-3 py-2.5 text-sm hover:bg-slate-50">{t}</a>)}
              <Link href="/login" className="block rounded-lg px-3 py-2.5 text-sm hover:bg-slate-50">Entrar</Link>
              <Link href="/novo-grupo" className="mt-1 flex items-center justify-center gap-2 rounded-full bg-[#0057B8] px-4 py-3 text-sm font-medium text-white">Criar conta grátis <ArrowRight className="size-4" /></Link>
            </div>
          </details>
        </div>
      </header>
      <main id="conteudo" className="pt-16">{children}</main>
      <footer className="border-t border-slate-100 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 text-sm text-slate-500 sm:flex-row">
          <span className="font-semibold text-[#17365D]">GEAB Futebol</span>
          <span>Gestão de atletas, jogos e mensalidades para grupos de futebol.</span>
          <span className="flex gap-4"><Link href="/site" className="hover:text-[#0057B8]">Site</Link><Link href="/login" className="hover:text-[#0057B8]">Entrar</Link></span>
        </div>
      </footer>
    </div>
  )
}
