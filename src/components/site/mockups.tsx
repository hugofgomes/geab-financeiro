import { cn } from "@/lib/utils"
import { Check, CircleDollarSign, Trophy, Users } from "lucide-react"

/* Telas ilustrativas do produto, desenhadas em HTML/CSS (nítidas em qualquer tela).
   Todos os números e nomes são FICTÍCIOS. A fonte é proporcional à largura (cqw) para o mockup escalar inteiro. */

const NAVY = "#17365D"
const BLUE = "#0057B8"

export function Laptop({ children, className, label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <figure className={cn("w-full", className)} aria-label={label}>
      <div className="rounded-[2.2%/3.6%] border border-slate-300/80 bg-slate-800 p-[1.2%] shadow-[0_30px_80px_-30px_rgba(23,54,93,.45)]">
        <div className="@container aspect-[16/10] overflow-hidden rounded-[1.2%/1.9%] bg-white">{children}</div>
      </div>
      <div className="mx-auto h-[1.6%] min-h-2 w-[112%] -translate-x-[5.4%] rounded-b-[40%] bg-gradient-to-b from-slate-300 to-slate-200 shadow-md" />
    </figure>
  )
}

export function Phone({ children, className, label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <figure className={cn("w-full", className)} aria-label={label}>
      <div className="rounded-[14%/6.5%] border-[3px] border-slate-800 bg-slate-800 p-[3%] shadow-[0_30px_70px_-20px_rgba(23,54,93,.55)]">
        <div className="@container aspect-[9/16] overflow-hidden rounded-[11%/5%] bg-white">{children}</div>
      </div>
    </figure>
  )
}

export function Float({ icon: Icon, title, value, className, delay = 0 }: { icon: typeof Users; title: string; value: string; className?: string; delay?: number }) {
  return (
    <div style={{ animationDelay: `${delay}s` }}
      className={cn("site-float absolute z-10 flex items-center gap-3 rounded-2xl border border-slate-100 bg-white/95 px-3.5 py-3 shadow-[0_12px_40px_-16px_rgba(23,54,93,.35)] backdrop-blur", className)}>
      <span aria-hidden className="grid size-9 place-items-center rounded-xl bg-[#0057B8]/10 text-[#0057B8]"><Icon className="size-[18px]" /></span>
      <span className="leading-tight"><span className="block text-[11px] text-slate-500">{title}</span><span className="block text-sm font-semibold text-[#17365D] tabular-nums">{value}</span></span>
    </div>
  )
}

function Sidebar({ active }: { active: string }) {
  const items = ["Painel", "Atletas", "Mensalidades", "Jogos", "Escalação", "Caixa"]
  return (
    <div className="flex w-[17%] shrink-0 flex-col gap-[.5em] p-[1em]" style={{ background: NAVY }}>
      <div className="mb-[.8em] text-[1.05em] font-bold text-white">GEAB <span className="font-normal text-blue-200">Futebol</span></div>
      {items.map((i) => (
        <div key={i} className={cn("rounded-[.5em] px-[.7em] py-[.45em] text-[.85em]", i === active ? "bg-white/15 font-semibold text-white" : "text-blue-200/80")}>{i}</div>
      ))}
    </div>
  )
}

const BARS = [38, 52, 44, 61, 58, 70, 66, 74, 69, 82, 78, 90]

function Chart({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-end gap-[.5em]", className)} aria-hidden>
      {BARS.map((h, i) => <div key={i} className="flex-1 rounded-t-[.25em]" style={{ height: `${h}%`, background: i === BARS.length - 1 ? BLUE : "#BFD7F2" }} />)}
    </div>
  )
}

function Kpi({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="rounded-[.8em] border border-slate-100 bg-white p-[.8em] shadow-sm">
      <div className="text-[.75em] text-slate-500">{k}</div>
      <div className="mt-[.2em] text-[1.5em] font-semibold tabular-nums" style={{ color: tone ?? NAVY }}>{v}</div>
    </div>
  )
}

export function DashboardScreen() {
  return (
    <div className="flex h-full text-[1.5cqw]" style={{ color: NAVY }}>
      <Sidebar active="Painel" />
      <div className="min-w-0 flex-1 bg-slate-50 p-[1.2em]">
        <div className="mb-[.8em] text-[1.3em] font-semibold">Painel</div>
        <div className="grid grid-cols-4 gap-[.7em]">
          <Kpi k="Atletas ativos" v="24" /><Kpi k="Recebido no mês" v="R$ 1.870" tone="#15803D" /><Kpi k="Pendente" v="R$ 410" tone="#B4151B" /><Kpi k="Saldo do caixa" v="R$ 3.240" />
        </div>
        <div className="mt-[.8em] grid grid-cols-3 gap-[.7em]">
          <div className="col-span-2 rounded-[.8em] border border-slate-100 bg-white p-[.9em] shadow-sm">
            <div className="text-[.8em] font-semibold">Arrecadação · 12 meses</div>
            <Chart className="mt-[.6em] h-[9em]" />
          </div>
          <div className="space-y-[.7em]">
            <div className="rounded-[.8em] border border-slate-100 bg-white p-[.8em] shadow-sm">
              <div className="text-[.75em] text-slate-500">Próximo jogo</div>
              <div className="mt-[.2em] text-[.95em] font-semibold">Sábado · 16h</div>
              <div className="text-[.75em] text-slate-500">Azul × Branco</div>
            </div>
            <div className="rounded-[.8em] border border-slate-100 bg-white p-[.8em] shadow-sm">
              <div className="text-[.75em] text-slate-500">Artilharia</div>
              {[["Carlos", 9], ["Rafael", 7], ["Diego", 6]].map(([n, g], i) => (
                <div key={n} className="mt-[.3em] flex justify-between text-[.8em]"><span>{["🥇", "🥈", "🥉"][i]} {n}</span><b className="tabular-nums">{g}</b></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const AZUL = ["Carlos", "Diego", "Bruno", "Thiago", "Lucas", "André", "Paulo"]
const BRANCO = ["Rafael", "Marcos", "Felipe", "Gustavo", "Renato", "Caio", "Vitor"]

function Team({ name, color, players, dark }: { name: string; color: string; players: string[]; dark?: boolean }) {
  return (
    <div className="min-w-0 flex-1 overflow-hidden rounded-[.8em] border border-slate-200 bg-white shadow-sm">
      <div className="px-[.8em] py-[.5em] text-[.9em] font-bold tracking-wide" style={{ background: color, color: dark ? "#fff" : NAVY }}>{name}</div>
      <ul className="divide-y divide-slate-100">
        {players.map((p, i) => <li key={p} className="flex items-center gap-[.6em] px-[.8em] py-[.35em] text-[.85em]"><span className="w-[1.4em] text-slate-400 tabular-nums">{i + 1}</span>{p}</li>)}
      </ul>
    </div>
  )
}

export function LineupScreen() {
  return (
    <div className="flex h-full text-[1.5cqw]" style={{ color: NAVY }}>
      <Sidebar active="Escalação" />
      <div className="min-w-0 flex-1 bg-slate-50 p-[1.2em]">
        <div className="mb-[.8em] flex items-center justify-between"><div className="text-[1.3em] font-semibold">Escalação</div>
          <div className="rounded-[.6em] px-[.9em] py-[.4em] text-[.8em] font-semibold text-white" style={{ background: BLUE }}>Distribuir automaticamente</div></div>
        <div className="flex gap-[.8em]"><Team name="AZUL" color={BLUE} players={AZUL} dark /><Team name="BRANCO" color="#EEF3FA" players={BRANCO} /></div>
        <div className="mt-[.8em] flex gap-[.5em] text-[.75em]">
          {["WhatsApp status 1080×1920", "Vertical", "Quadrado"].map((f, i) => <span key={f} className={cn("rounded-full border px-[.8em] py-[.3em]", i === 0 ? "border-transparent text-white" : "border-slate-200 bg-white text-slate-500")} style={i === 0 ? { background: NAVY } : undefined}>{f}</span>)}
        </div>
      </div>
    </div>
  )
}

export function LineupCardPhone() {
  return (
    <div className="flex h-full flex-col text-[5.2cqw]" style={{ background: `linear-gradient(180deg, ${NAVY}, #0C2240)` }}>
      <div className="px-[1em] pt-[1.6em] text-center text-white"><div className="text-[.6em] tracking-[.3em] text-blue-200">ESCALAÇÃO</div><div className="mt-[.2em] text-[1.1em] font-bold">Sábado · 16h</div></div>
      <div className="mt-[.8em] grid flex-1 grid-cols-2 gap-[.5em] px-[.6em]">
        {[["AZUL", BLUE, AZUL, "#fff"], ["BRANCO", "#F4F7FB", BRANCO, NAVY]].map(([n, bg, list, fg]) => (
          <div key={n as string} className="rounded-[.6em] p-[.5em]" style={{ background: "rgba(255,255,255,.07)" }}>
            <div className="mb-[.4em] rounded-[.4em] py-[.25em] text-center text-[.7em] font-bold" style={{ background: bg as string, color: fg as string }}>{n as string}</div>
            {(list as string[]).map((p) => <div key={p} className="py-[.18em] text-center text-[.72em] text-white">{p}</div>)}
          </div>
        ))}
      </div>
      <div className="py-[.9em] text-center text-[.5em] text-blue-200">Gerado no GEAB Futebol</div>
    </div>
  )
}

export function FinanceScreen() {
  const rows: [string, string, string, boolean][] = [["Carlos", "R$ 70,00", "Pix", true], ["Rafael", "R$ 70,00", "Pix", true], ["Diego", "R$ 70,00", "—", false], ["Bruno", "R$ 70,00", "Dinheiro", true], ["Thiago", "R$ 70,00", "—", false]]
  return (
    <div className="flex h-full text-[1.5cqw]" style={{ color: NAVY }}>
      <Sidebar active="Mensalidades" />
      <div className="min-w-0 flex-1 bg-slate-50 p-[1.2em]">
        <div className="mb-[.8em] text-[1.3em] font-semibold">Mensalidades</div>
        <div className="grid grid-cols-3 gap-[.7em]"><Kpi k="Previsto" v="R$ 1.680" /><Kpi k="Recebido" v="R$ 1.270" tone="#15803D" /><Kpi k="Pendente" v="R$ 410" tone="#B4151B" /></div>
        <div className="mt-[.8em] grid grid-cols-5 gap-[.7em]">
          <div className="col-span-3 overflow-hidden rounded-[.8em] border border-slate-100 bg-white shadow-sm">
            {rows.map(([n, v, m, ok]) => (
              <div key={n} className="flex items-center gap-[.6em] border-b border-slate-100 px-[.8em] py-[.5em] text-[.85em] last:border-0">
                <span className="flex-1">{n}</span><span className="tabular-nums text-slate-500">{v}</span><span className="w-[4.5em] text-slate-400">{m}</span>
                <span className={cn("rounded-full px-[.6em] py-[.1em] text-[.8em] font-semibold", ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>{ok ? "Pago" : "Pendente"}</span>
              </div>
            ))}
          </div>
          <div className="col-span-2 rounded-[.8em] border border-slate-100 bg-white p-[.9em] shadow-sm"><div className="text-[.8em] font-semibold">Arrecadação</div><Chart className="mt-[.6em] h-[8em]" /></div>
        </div>
      </div>
    </div>
  )
}

export function Benefit({ children }: { children: React.ReactNode }) {
  return <li className="flex items-center gap-3 text-[15px] text-slate-700"><span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-[#0057B8] text-white"><Check className="size-3" strokeWidth={3} /></span>{children}</li>
}

export { CircleDollarSign, Trophy, Users }
