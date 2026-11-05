"use client"

import { ScorersCard } from "@/components/scorers-panel"
import { Skeleton } from "@/components/ui/skeleton"
import { brToday, dayMonth, hhmm, monthNameOf, MATCHES_CHANGED, shortDate, splitMatches, teamDot, weekdayOf, winnerOf } from "@/lib/matches"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Match, MonthBirthday } from "@/lib/types"
import { cn } from "@/lib/utils"
import { CalendarClock, Cake, ChevronDown, PartyPopper, PanelRightClose, PanelRightOpen, Trophy } from "lucide-react"
import * as React from "react"

const REFRESH_MS = 60_000
const KEY = "geab.painel.aberto"

type PanelData = { matches: Match[]; birthdays: MonthBirthday[] }

/** Carrega jogos e aniversariantes; atualiza a cada minuto (aba visível), ao voltar à aba e quando a Diretoria salva um jogo. */
function usePanelData() {
  const [state, setState] = React.useState<{ data: PanelData | null; error: string | null }>({ data: null, error: null })
  React.useEffect(() => {
    if (!supabaseConfigured) return
    let alive = true
    let busy = false
    async function load() {
      if (busy || !alive) return
      busy = true
      try {
        const sb = supabase()
        const [m, b] = await Promise.all([
          sb.from("matches").select("id, match_date, match_time, team_a, team_b, score_a, score_b, status")
            .order("match_date", { ascending: false }).order("match_time", { ascending: false, nullsFirst: false }).limit(40),
          sb.rpc("month_birthdays"),
        ])
        if (m.error) throw new Error(m.error.message)
        if (b.error) throw new Error(b.error.message)
        if (alive) setState({ data: { matches: m.data as Match[], birthdays: (b.data ?? []) as MonthBirthday[] }, error: null })
      } catch (e) {
        if (alive) setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : String(e) }))
      } finally { busy = false }
    }
    const tick = () => document.visibilityState === "visible" && load()
    load()
    const t = setInterval(tick, REFRESH_MS)
    document.addEventListener("visibilitychange", tick)
    window.addEventListener(MATCHES_CHANGED, load)
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", tick); window.removeEventListener(MATCHES_CHANGED, load) }
  }, [])
  return state
}

function Team({ name, score, win, lose }: { name: string; score: number | null; win: boolean; lose: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
      <span aria-hidden className={cn("size-4 rounded-full", teamDot(name))} />
      <span className={cn("w-full truncate text-xs", win ? "font-semibold text-foreground" : "text-muted-foreground")} title={name}>{name}</span>
      <span className={cn("text-3xl leading-none font-bold tabular-nums", win ? "text-primary" : lose ? "text-muted-foreground/70" : "text-primary")}>{score ?? "–"}</span>
    </div>
  )
}

function ResultText({ m }: { m: Match }) {
  const w = winnerOf(m)
  if (!w) return null
  return <>{w === "empate" ? "Empate" : `Vitória da ${w === "a" ? m.team_a : m.team_b}`}</>
}

function Scoreboard({ m, live }: { m: Match; live?: boolean }) {
  const w = winnerOf(m)
  return (
    <div className={cn("rounded-xl border p-3", live ? "border-[#F32329]/40 bg-[#F32329]/5" : "bg-card")}>
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold tracking-wide uppercase">
        <span className={live ? "flex items-center gap-1.5 text-[#B4151B]" : "text-muted-foreground"}>
          {live && <span aria-hidden className="relative flex size-2"><span className="absolute inline-flex size-full rounded-full bg-[#F32329] opacity-70 motion-safe:animate-ping" /><span className="relative inline-flex size-2 rounded-full bg-[#F32329]" /></span>}
          {live ? "Em andamento" : `Último jogo — ${shortDate(m.match_date)}`}
        </span>
        {!live && <span className="rounded-full bg-secondary px-2 py-0.5 text-primary normal-case">Finalizado</span>}
      </div>
      <div className="flex items-center gap-2">
        <Team name={m.team_a} score={m.score_a ?? (live ? 0 : null)} win={w === "a"} lose={w === "b"} />
        <span aria-hidden className="text-lg font-semibold text-muted-foreground">×</span>
        <Team name={m.team_b} score={m.score_b ?? (live ? 0 : null)} win={w === "b"} lose={w === "a"} />
      </div>
      {live
        ? <p className="mt-2 text-center text-xs text-muted-foreground">{weekdayOf(m.match_date)} · {shortDate(m.match_date)}{hhmm(m.match_time) ? ` · ${hhmm(m.match_time)}` : ""}</p>
        : <p className="mt-2 text-center text-xs font-medium text-primary"><ResultText m={m} /></p>}
    </div>
  )
}

function Scores({ matches }: { matches: Match[] }) {
  const { live, last, history, next } = splitMatches(matches)
  return (
    <section aria-labelledby="pn-jogos" className="space-y-3">
      <h2 id="pn-jogos" className="flex items-center gap-2 text-sm font-semibold text-primary"><Trophy className="size-4 text-[#F32329]" aria-hidden /> Placar dos jogos</h2>
      {live.map((m) => <Scoreboard key={m.id} m={m} live />)}
      {last ? <Scoreboard m={last} /> : !live.length && <p className="rounded-xl border border-dashed p-3 text-center text-sm text-muted-foreground">Nenhum jogo finalizado ainda.</p>}

      {history.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Jogos anteriores</h3>
          <ul className="divide-y rounded-xl border bg-card text-xs">
            {history.map((m) => {
              const w = winnerOf(m)
              return (
                <li key={m.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="w-10 shrink-0 text-muted-foreground tabular-nums">{dayMonth(m.match_date)}</span>
                  <span className={cn("min-w-0 flex-1 truncate", w === "a" && "font-semibold")} title={m.team_a}>{brief(m.team_a)}</span>
                  <span className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 font-semibold text-primary tabular-nums">{m.score_a} × {m.score_b}</span>
                  <span className={cn("min-w-0 flex-1 truncate text-right", w === "b" && "font-semibold")} title={m.team_b}>{brief(m.team_b)}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="rounded-xl border bg-card p-3">
        <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"><CalendarClock className="size-3.5" aria-hidden /> Próximo jogo</h3>
        {next ? (
          <>
            <p className="text-sm font-semibold text-primary">{weekdayOf(next.match_date)} | {shortDate(next.match_date)}</p>
            <p className="text-xs text-muted-foreground">Horário: {hhmm(next.match_time) ?? "A definir"}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs"><span aria-hidden className={cn("size-2.5 rounded-full", teamDot(next.team_a))} />{next.team_a}<span className="text-muted-foreground">×</span><span aria-hidden className={cn("size-2.5 rounded-full", teamDot(next.team_b))} />{next.team_b}</p>
          </>
        ) : <p className="text-sm text-muted-foreground">Nenhum jogo agendado.</p>}
      </div>
    </section>
  )
}

const brief = (n: string) => n.replace(/^equipe\s+/i, "")
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase()

function Birthdays({ list }: { list: MonthBirthday[] }) {
  const today = brToday()
  const dayNow = Number(today.slice(8, 10))
  return (
    <section aria-labelledby="pn-aniv" className="space-y-3">
      <h2 id="pn-aniv" className="flex items-center gap-2 text-sm font-semibold text-primary"><Cake className="size-4 text-[#F32329]" aria-hidden /> Aniversariantes de {monthNameOf(today).charAt(0) + monthNameOf(today).slice(1).toLowerCase()}</h2>
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed p-3 text-center text-sm text-muted-foreground">Nenhum aniversariante neste mês. 🎈</p>
      ) : (
        <ul className="space-y-2">
          {list.map((b) => (
            <li
              key={b.display_name + b.bday}
              className={cn("flex items-center gap-3 rounded-xl border p-2.5", b.is_today ? "border-[#F32329]/40 bg-[#F32329]/5 shadow-sm" : "bg-card", !b.is_today && b.bday < dayNow && "opacity-60")}
            >
              <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold", b.is_today ? "bg-[#F32329] text-white" : "bg-secondary text-primary")}>{initials(b.display_name)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{b.display_name}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="tabular-nums">{String(b.bday).padStart(2, "0")}/{String(b.bmonth).padStart(2, "0")}</span> · {b.is_today ? `completa ${b.turning_age} anos hoje` : `${b.bday < dayNow ? "completou" : "completa"} ${b.turning_age} anos`}
                </p>
                {b.is_today && <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-[#B4151B]"><PartyPopper className="size-3.5" aria-hidden /> Parabéns, {b.display_name.split(" ")[0]}! 🎉</p>}
              </div>
              <span aria-hidden className="text-lg">{b.is_today ? "🎂" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Barra lateral direita: placar dos jogos e aniversariantes do mês. Recolhível; empilha abaixo do conteúdo em telas menores. */
export function SidePanel() {
  const { data, error } = usePanelData()
  const [open, setOpen] = React.useState(true)
  React.useEffect(() => {
    try {
      const v = localStorage.getItem(KEY)
      setOpen(v ? v === "1" : window.matchMedia("(min-width: 768px)").matches)
    } catch { /* sem armazenamento: mantém aberto */ }
  }, [])
  const toggle = () => setOpen((o) => { try { localStorage.setItem(KEY, o ? "0" : "1") } catch { /* ignore */ } return !o })

  if (!supabaseConfigured) return null
  return (
    <aside aria-label="Placar, aniversariantes e artilharia" className={cn("w-full shrink-0 transition-[width] duration-200 motion-reduce:transition-none xl:sticky xl:top-[5.5rem] xl:self-start", open ? "xl:w-80" : "xl:w-11")}>
      {/* telas menores: seção expansível abaixo do conteúdo */}
      <button
        type="button" onClick={toggle} aria-expanded={open} aria-controls="painel-corpo"
        className={cn("flex w-full items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-semibold text-primary shadow-sm outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring xl:hidden")}
      >
        <span className="flex items-center gap-2"><Trophy className="size-4 text-[#F32329]" aria-hidden /> Placar, aniversariantes e artilharia</span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {/* desktop largo: barra à direita, recolhível */}
      <button
        type="button" onClick={toggle} aria-expanded={open} aria-controls="painel-corpo"
        aria-label={open ? "Recolher barra lateral" : "Abrir barra lateral de placar e aniversariantes"}
        title={open ? "Recolher" : "Placar e aniversariantes"}
        className={cn("hidden h-9 items-center gap-2 rounded-lg border bg-card px-2.5 text-sm text-primary shadow-sm outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring xl:flex", open ? "w-full justify-between" : "w-11 justify-center px-0")}
      >
        {open && <span className="text-xs font-semibold tracking-wide uppercase">Painel</span>}
        {open ? <PanelRightClose className="size-4" aria-hidden /> : <PanelRightOpen className="size-4" aria-hidden />}
      </button>

      <div id="painel-corpo" hidden={!open} className={cn("mt-3 space-y-6 rounded-xl border bg-card/60 p-4 shadow-sm motion-safe:animate-in motion-safe:fade-in", !open && "xl:hidden")}>
        {error && !data && <p role="alert" className="text-sm text-destructive">Não foi possível carregar o painel: {error}</p>}
        {!data && !error && <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-20" /><Skeleton className="h-24" /></div>}
        {data && (
          <>
            <Scores matches={data.matches} />
            <Birthdays list={data.birthdays} />
            <ScorersCard />
            {error && <p className="text-xs text-muted-foreground">Sem conexão no momento; exibindo os últimos dados carregados.</p>}
          </>
        )}
      </div>
    </aside>
  )
}
