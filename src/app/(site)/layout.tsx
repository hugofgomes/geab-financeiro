import { ArrowRight, Menu } from "lucide-react"
import Link from "next/link"

const LINKS = [["Recursos", "/site#gestao"], ["Jogos", "/site#jogos"], ["Financeiro", "/site#financeiro"], ["Planos", "/site#planos"]]

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh overflow-x-clip bg-white text-slate-700 [--site-blue:#0057B8] [--site-navy:#17365D]">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <Link href="/site" className="text-lg font-bold tracking-tight text-[#17365D]">GEAB <span className="font-normal text-[#0057B8]">Futebol</span></Link>
          <nav aria-label="Principal" className="hidden items-center gap-7 text-sm md:flex">
            {LINKS.map(([t, h]) => <a key={t} href={h} className="text-slate-600 transition-colors hover:text-[#0057B8]">{t}</a>)}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <Link href="/login" className="text-sm text-slate-600 transition-colors hover:text-[#0057B8]">Entrar</Link>
            <Link href="/demo" className="text-sm text-slate-600 transition-colors hover:text-[#0057B8]">Demonstração</Link>
            <Link href="/novo-grupo" className="rounded-full bg-[#0057B8] px-5 py-2 text-sm font-medium text-white transition hover:-translate-y-px hover:bg-[#004a9e]">Criar conta grátis</Link>
          </div>
          <details className="group relative md:hidden">
            <summary aria-label="Abrir menu" className="grid size-10 cursor-pointer list-none place-items-center rounded-lg text-[#17365D] [&::-webkit-details-marker]:hidden"><Menu className="size-6" /></summary>
            <div className="absolute right-0 mt-2 w-64 space-y-1 rounded-2xl border border-slate-100 bg-white p-3 shadow-xl">
              {LINKS.map(([t, h]) => <a key={t} href={h} className="block rounded-lg px-3 py-2.5 text-sm hover:bg-slate-50">{t}</a>)}
              <Link href="/login" className="block rounded-lg px-3 py-2.5 text-sm hover:bg-slate-50">Entrar</Link>
              <Link href="/demo" className="block rounded-lg px-3 py-2.5 text-sm hover:bg-slate-50">Demonstração</Link>
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
          <span className="flex gap-4"><Link href="/demo" className="hover:text-[#0057B8]">Demonstração</Link><Link href="/login" className="hover:text-[#0057B8]">Entrar</Link></span>
        </div>
      </footer>
    </div>
  )
}
