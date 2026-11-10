"use client"

import { Benefit } from "@/components/site/mockups"
import { cn } from "@/lib/utils"
import { Info, Minus, Plus, Shuffle } from "lucide-react"
import Link from "next/link"
import * as React from "react"

// Tudo aqui é FICTÍCIO e vive só na memória desta página: nada é enviado ou salvo.
const NAMES = ["Carlos", "Rafael", "Diego", "Bruno", "Thiago", "Lucas", "André", "Paulo", "Marcos", "Felipe", "Gustavo", "Renato", "Caio", "Vitor"]
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const TABS = ["Painel", "Atletas", "Mensalidades", "Escalação", "Ao vivo"] as const
type Tab = (typeof TABS)[number]
const FEE = 70

function shuffle<T>(a: T[], seed: number) {
  const r = [...a]; let s = seed
  for (let i = r.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [r[i], r[j]] = [r[j], r[i]] }
  return r
}

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn("rounded-2xl border border-slate-100 bg-white p-4 shadow-sm", className)}>{children}</div>
const Kpi = ({ k, v, tone }: { k: string; v: string; tone?: string }) => <Card><div className="text-xs text-slate-500">{k}</div><div className={cn("mt-1 text-2xl font-semibold tabular-nums text-[#17365D]", tone)}>{v}</div></Card>

export function DemoApp() {
  const [tab, setTab] = React.useState<Tab>("Painel")
  const [paid, setPaid] = React.useState<Set<string>>(() => new Set(NAMES.slice(0, 9)))
  const [seed, setSeed] = React.useState(1)
  const [goals, setGoals] = React.useState<Record<string, number>>({ Carlos: 9, Rafael: 7, Diego: 6 })
  const received = paid.size * FEE
  const teams = React.useMemo(() => { const s = shuffle(NAMES, seed); return { azul: s.slice(0, 7), branco: s.slice(7) } }, [seed])
  const ranking = Object.entries(goals).filter(([, g]) => g > 0).sort((a, b) => b[1] - a[1])

  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 pb-28 sm:pb-16">
      <div className="flex items-start gap-3 rounded-2xl border border-[#0057B8]/20 bg-[#F3F8FE] p-4 text-sm text-[#17365D]">
        <Info className="mt-0.5 size-4 shrink-0 text-[#0057B8]" />
        <p><b>Versão de demonstração.</b> Todos os nomes e valores são fictícios e nada é salvo. Mexa à vontade: marque pagamentos, sorteie os times, registre gols.</p>
      </div>

      <nav aria-label="Telas da demonstração" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white/95 backdrop-blur sm:static sm:mt-6 sm:gap-2 sm:border-0 sm:bg-transparent sm:backdrop-blur-none">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-current={tab === t ? "page" : undefined}
            className={cn("flex-1 px-1 py-3.5 text-[12px] font-medium transition sm:flex-none sm:rounded-full sm:px-5 sm:py-2 sm:text-sm", tab === t ? "text-[#0057B8] sm:bg-[#0057B8] sm:text-white" : "text-slate-500 hover:text-[#0057B8] sm:border sm:border-slate-200")}>{t}</button>
        ))}
      </nav>

      <div className="mt-6 space-y-4">
        {tab === "Painel" && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi k="Atletas ativos" v={String(NAMES.length)} /><Kpi k="Recebido no mês" v={brl(received)} tone="text-green-700" />
              <Kpi k="Pendente" v={brl((NAMES.length - paid.size) * FEE)} tone="text-[#B4151B]" /><Kpi k="Saldo do caixa" v={brl(3240 + received - 1270)} />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Card className="md:col-span-2"><div className="text-sm font-semibold text-[#17365D]">Arrecadação · 12 meses</div>
                <div className="mt-4 flex h-40 items-end gap-2" aria-hidden>{[38, 52, 44, 61, 58, 70, 66, 74, 69, 82, 78, 90].map((h, i) => <div key={i} className="flex-1 rounded-t-md transition-all" style={{ height: `${h}%`, background: i === 11 ? "#0057B8" : "#BFD7F2" }} />)}</div></Card>
              <Card><div className="text-sm font-semibold text-[#17365D]">Artilharia</div>
                <ol className="mt-3 space-y-2 text-sm">{ranking.slice(0, 5).map(([n, g], i) => <li key={n} className="flex justify-between"><span>{["🥇", "🥈", "🥉"][i] ?? `${i + 1}º`} {n}</span><b className="tabular-nums">{g}</b></li>)}</ol></Card>
            </div>
          </>
        )}

        {tab === "Atletas" && (
          <Card className="p-0"><ul className="divide-y divide-slate-100">{NAMES.map((n, i) => (
            <li key={n} className="flex items-center gap-3 px-4 py-3"><span aria-hidden className="grid size-9 place-items-center rounded-full bg-[#0057B8]/10 text-sm font-semibold text-[#0057B8]">{n[0]}</span>
              <span className="flex-1 text-sm font-medium text-[#17365D]">{n} <span className="font-normal text-slate-400">· Atleta {i + 1}</span></span><span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">Ativo</span></li>))}</ul></Card>
        )}

        {tab === "Mensalidades" && (
          <>
            <div className="grid grid-cols-3 gap-3"><Kpi k="Previsto" v={brl(NAMES.length * FEE)} /><Kpi k="Recebido" v={brl(received)} tone="text-green-700" /><Kpi k="Pendente" v={brl((NAMES.length - paid.size) * FEE)} tone="text-[#B4151B]" /></div>
            <Card className="p-0"><ul className="divide-y divide-slate-100">{NAMES.map((n) => { const ok = paid.has(n); return (
              <li key={n} className="flex items-center gap-3 px-4 py-3 text-sm"><span className="flex-1 font-medium text-[#17365D]">{n}</span><span className="text-slate-500 tabular-nums">{brl(FEE)}</span>
                <button onClick={() => setPaid((p) => { const s = new Set(p); if (s.has(n)) s.delete(n); else s.add(n); return s })} aria-pressed={ok}
                  className={cn("w-24 rounded-full py-1.5 text-xs font-semibold transition", ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700 hover:bg-red-200")}>{ok ? "Pago ✓" : "Registrar"}</button></li>) })}</ul></Card>
          </>
        )}

        {tab === "Escalação" && (
          <>
            <button onClick={() => setSeed((s) => s + 1)} className="inline-flex items-center gap-2 rounded-full bg-[#0057B8] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#004a9e]"><Shuffle className="size-4" /> Distribuir automaticamente</button>
            <div className="grid gap-3 sm:grid-cols-2">
              {([["AZUL", "#0057B8", "#fff", teams.azul], ["BRANCO", "#EEF3FA", "#17365D", teams.branco]] as const).map(([n, bg, fg, list]) => (
                <Card key={n} className="overflow-hidden p-0"><div className="px-4 py-2.5 text-sm font-bold tracking-wide" style={{ background: bg, color: fg }}>{n}</div>
                  <ol className="divide-y divide-slate-100">{list.map((p, i) => <li key={p} className="flex gap-3 px-4 py-2 text-sm"><span className="w-5 text-slate-400 tabular-nums">{i + 1}</span>{p}</li>)}</ol></Card>))}
            </div>
          </>
        )}

        {tab === "Ao vivo" && (
          <Card className="p-0"><p className="border-b border-slate-100 px-4 py-3 text-sm text-slate-500">Toque em + a cada gol. A artilharia do painel acompanha.</p>
            <ul className="divide-y divide-slate-100">{NAMES.slice(0, 8).map((n) => (
              <li key={n} className="flex items-center gap-3 px-4 py-3"><span className="flex-1 text-sm font-medium text-[#17365D]">{n}</span>
                <button aria-label={`Remover gol de ${n}`} onClick={() => setGoals((g) => ({ ...g, [n]: Math.max(0, (g[n] ?? 0) - 1) }))} className="grid size-9 place-items-center rounded-full border border-slate-200 text-slate-500"><Minus className="size-4" /></button>
                <span className="w-6 text-center text-lg font-bold tabular-nums text-[#17365D]">{goals[n] ?? 0}</span>
                <button aria-label={`Marcar gol de ${n}`} onClick={() => setGoals((g) => ({ ...g, [n]: (g[n] ?? 0) + 1 }))} className="grid size-9 place-items-center rounded-full bg-[#0057B8] text-white"><Plus className="size-4" /></button></li>))}</ul></Card>
        )}
      </div>

      <div className="mt-10 rounded-3xl bg-[#17365D] p-8 text-center text-white">
        <h2 className="text-2xl font-bold !text-white">Gostou? Crie o seu grupo.</h2>
        <ul className="mx-auto mt-4 hidden max-w-xs space-y-2 text-left sm:block [&_li]:text-blue-100 [&_span]:bg-white [&_span]:text-[#17365D]"><Benefit>Teste gratuito por 10 dias, até 30 jogadores</Benefit><Benefit>Seus dados separados dos de outros grupos</Benefit></ul>
        <Link href="/novo-grupo" className="mt-6 inline-flex rounded-full bg-white px-7 py-3 text-sm font-medium text-[#17365D] transition hover:-translate-y-0.5">Criar meu grupo</Link>
      </div>
    </div>
  )
}
