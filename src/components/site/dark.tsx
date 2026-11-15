import { cn } from "@/lib/utils"
import { Check } from "lucide-react"

export const NEON = "#39FF14"
export const HEAD = "font-[family-name:var(--font-sora)]"
export const BTN_PRIMARY = "inline-flex items-center justify-center gap-2 rounded-full bg-[#39FF14] px-7 py-4 text-[15px] font-bold tracking-wide text-[#04130B] shadow-[0_12px_40px_-14px_rgba(57,255,20,.65)] transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:translate-y-0"
export const BTN_GHOST = "inline-flex items-center justify-center gap-2 rounded-full border border-white/25 px-7 py-4 text-[15px] font-bold tracking-wide text-white transition hover:-translate-y-0.5 hover:border-[#39FF14]/60 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-[#39FF14] focus-visible:outline-none active:translate-y-0"

export function SectionHead({ eyebrow, title, text, center }: { eyebrow?: string; title: string; text?: string; center?: boolean }) {
  return (
    <div className={cn("max-w-2xl", center && "mx-auto text-center")}>
      {eyebrow && <p className="mb-3 text-xs font-semibold tracking-[.22em] text-[#39FF14] uppercase">{eyebrow}</p>}
      <h2 className={cn(HEAD, "text-balance text-3xl font-extrabold tracking-tight text-white uppercase sm:text-4xl lg:text-[2.6rem] lg:leading-[1.08]")}>{title}</h2>
      {text && <p className="mt-4 text-lg leading-relaxed text-[#AAB4AE]">{text}</p>}
    </div>
  )
}

export function Tick({ children, off }: { children: React.ReactNode; off?: boolean }) {
  return off
    ? <li className="flex items-start gap-3 text-[15px] text-white/30 line-through decoration-white/20"><span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center">–</span><span><span className="sr-only">Não inclui: </span>{children}</span></li>
    : <li className="flex items-start gap-3 text-[15px] text-white/90"><span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#39FF14]/15 text-[#39FF14]"><Check className="size-3.5" strokeWidth={3} /></span><span>{children}</span></li>
}

/** Campo de futebol estilizado (ilustração): duas equipes em 4-3-3, uniformes em cores diferentes. Proporção 10:7. */
export function Pitch({ className }: { className?: string }) {
  const blue: [number, number][] = [[8, 35], [20, 12], [20, 28], [20, 42], [20, 58], [34, 18], [34, 35], [34, 52], [44, 12], [46, 35], [44, 58]]
  const white = blue.map(([x, y]) => [100 - x, 70 - y] as [number, number])
  return (
    <svg viewBox="0 0 100 70" role="img" aria-label="Campo de futebol com duas equipes escaladas, uma de azul e outra de branco (ilustração)" className={cn("h-full w-full", className)}>
      <defs>
        <linearGradient id="grass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#0B5A36" /><stop offset=".5" stopColor="#0A4D2F" /><stop offset="1" stopColor="#0B5A36" /></linearGradient>
        <radialGradient id="spot" cx="50%" cy="50%" r="55%"><stop offset="0" stopColor="#39FF14" stopOpacity=".18" /><stop offset="1" stopColor="#39FF14" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="100" height="70" fill="url(#grass)" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={i} x={i * 12.5} y="0" width="6.25" height="70" fill="#fff" opacity=".035" />)}
      <rect width="100" height="70" fill="url(#spot)" />
      <g fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth=".3">
        <rect x="3" y="3" width="94" height="64" /><line x1="50" y1="3" x2="50" y2="67" /><circle cx="50" cy="35" r="9" />
        <rect x="3" y="17" width="16" height="36" /><rect x="3" y="26" width="6" height="18" /><rect x="81" y="17" width="16" height="36" /><rect x="91" y="26" width="6" height="18" />
        <path d="M19 29 A9 9 0 0 1 19 41" /><path d="M81 29 A9 9 0 0 0 81 41" />
      </g>
      <circle cx="50" cy="35" r=".6" fill="#fff" />
      {blue.map(([x, y], i) => <g key={`b${i}`}><circle cx={x} cy={y} r="3" fill="#2563EB" stroke="#fff" strokeWidth=".45" /><text x={x} y={y + 1.1} textAnchor="middle" fontSize="3" fontWeight="700" fill="#fff">{i + 1}</text></g>)}
      {white.map(([x, y], i) => <g key={`w${i}`}><circle cx={x} cy={y} r="3" fill="#fff" stroke="#9CA3AF" strokeWidth=".35" /><text x={x} y={y + 1.1} textAnchor="middle" fontSize="3" fontWeight="700" fill="#111827">{i + 1}</text></g>)}
    </svg>
  )
}
