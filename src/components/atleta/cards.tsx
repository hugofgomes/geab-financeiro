"use client"

import { AvatarAtleta, CardResumo, EmptyLine, StatusBadge, brief } from "@/components/atleta/ui"
import type { MyGame, PixOption } from "@/components/atleta/data"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatBRL, formatCompetence, formatDate } from "@/lib/format"
import { brToday, hhmm, monthNameOf, shortDate, teamDot, weekdayOf, winnerOf } from "@/lib/matches"
import type { Athlete, Charge, Match, MonthBirthday, Payment, Scorer, ScorerStats } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Cake, CalendarClock, CalendarDays, CircleDollarSign, Copy, ExternalLink, Flag, Medal, Pencil, QrCode, Target, Trophy, Wallet } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Team = "a" | "b" | "reserva" | null
const myTeamName = (m: Match, t: Team) => (t === "a" ? m.team_a : t === "b" ? m.team_b : null)
const goalsWord = (n: number) => `${n} ${n === 1 ? "gol" : "gols"}`

/** Dias entre hoje (Brasília) e a data do jogo. */
function daysUntil(iso: string) {
  const [y, m, d] = iso.split("-").map(Number)
  const [ty, tm, td] = brToday().split("-").map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000)
}
const countdown = (n: number) => (n <= 0 ? "É hoje!" : n === 1 ? "Amanhã" : `Faltam ${n} dias`)

function TeamName({ name }: { name: string }) {
  return <span className="inline-flex min-w-0 items-center gap-1.5"><span aria-hidden className={cn("size-3 shrink-0 rounded-full", teamDot(name))} /><span className="truncate">{name}</span></span>
}

/* ───────── Próximo jogo ───────── */
export function CardProximoJogo({ next, team }: { next: Match | null; team: Team }) {
  return (
    <CardResumo title="Próximo jogo" icon={CalendarDays} tone="brand" className="md:col-span-2">
      {!next ? <p className="py-2 text-sm text-white/80">Nenhum jogo agendado.</p> : (
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold capitalize sm:text-xl">{weekdayOf(next.match_date)}</p>
            <p className="text-3xl leading-tight font-bold tabular-nums sm:text-4xl">{shortDate(next.match_date)}<span className="ml-3 text-xl font-semibold text-white/85 sm:text-2xl">{hhmm(next.match_time) ?? "horário a definir"}</span></p>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-medium">
              <TeamName name={next.team_a} /><span aria-hidden className="text-white/60">×</span><TeamName name={next.team_b} />
            </p>
            {(next.venue || myTeamName(next, team)) && <p className="mt-1 text-sm text-white/75">{next.venue}{next.venue && myTeamName(next, team) ? " · " : ""}{myTeamName(next, team) && `Você joga de ${brief(myTeamName(next, team)!)}`}</p>}
          </div>
          <span className="rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-semibold backdrop-blur">{countdown(daysUntil(next.match_date))}</span>
        </div>
      )}
    </CardResumo>
  )
}

/* ───────── Mensalidade ───────── */
/** Mensalidade em foco: a em aberto com vencimento mais próximo; sem pendências, a mais recente. */
export function currentCharge(charges: Charge[]) {
  const open = charges.filter((c) => c.balance > 0).sort((a, b) => a.due_date.localeCompare(b.due_date))
  return { charge: open[0] ?? charges[0] ?? null, openCount: open.length }
}

export function CardMensalidade({ charges, pix, onPay, onSeeAll }: { charges: Charge[]; pix: Map<string, PixOption>; onPay: (o: PixOption) => void; onSeeAll: () => void }) {
  const { charge, openCount } = currentCharge(charges)
  const option = charge ? pix.get(charge.id) : undefined
  return (
    <CardResumo title="Minha mensalidade" icon={Wallet}>
      {!charge ? <EmptyLine>Nenhuma mensalidade gerada ainda.</EmptyLine> : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium capitalize">{formatCompetence(charge.competence)}</p>
              <p className="text-2xl font-bold tracking-tight tabular-nums">{formatBRL(charge.balance > 0 ? charge.balance : charge.amount)}</p>
              <p className="text-xs text-muted-foreground">Vencimento: {formatDate(charge.due_date)}</p>
            </div>
            <StatusBadge status={charge.display_status} />
          </div>
          {charge.balance > 0 && (option
            ? <Button type="button" className="h-11 w-full" onClick={() => onPay(option)}><QrCode /> Pagar mensalidade</Button>
            : <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">O PIX será disponibilizado pelo grupo.</p>)}
          {openCount > 1 && <button type="button" onClick={onSeeAll} className="min-h-11 text-left text-xs font-medium text-primary underline-offset-2 hover:underline">+{openCount - 1} {openCount - 1 === 1 ? "outra mensalidade em aberto" : "outras mensalidades em aberto"} · ver financeiro</button>}
        </div>
      )}
    </CardResumo>
  )
}

/* ───────── Desempenho ───────── */
export type Stat = { label: string; value: string }

export function statsFrom(s: ScorerStats | null): Stat[] {
  if (!s) return []
  return [
    { label: "Gols", value: String(s.goals) },
    { label: "Jogos", value: String(s.games) },
    { label: "Média", value: s.games ? `${String(s.avg).replace(".", ",")}` : "—" },
  ]
}

/** `extra` recebe estatísticas futuras (assistências, vitórias, cartões…) sem mudar o componente. */
export function CardDesempenho({ stats, extra = [] }: { stats: ScorerStats | null; extra?: Stat[] }) {
  const base = statsFrom(stats)
  return (
    <CardResumo title="Meu desempenho" icon={Target} action={stats && <span className="text-[11px] text-muted-foreground">Temporada {stats.season}</span>}>
      {!stats ? <EmptyLine>Ainda sem estatísticas.</EmptyLine> : (
        <div className="space-y-3">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[...base, ...extra].map((s) => (
              <div key={s.label} className="rounded-xl bg-secondary px-1 py-2.5">
                <dd className="text-2xl font-bold text-primary tabular-nums">{s.value}</dd>
                <dt className="text-[11px] text-muted-foreground">{s.label === "Média" ? "gols/jogo" : s.label}</dt>
              </div>
            ))}
          </dl>
          <p className="flex items-center gap-2 text-sm"><Medal className="size-4 text-amber-500" aria-hidden />
            {stats.position ? <>Artilharia: <b>{stats.position}º lugar</b></> : <span className="text-muted-foreground">Ainda sem gols na artilharia.</span>}</p>
        </div>
      )}
    </CardResumo>
  )
}

/* ───────── Último jogo ───────── */
export function CardUltimoJogo({ last, team }: { last: Match | null; team: Team }) {
  const w = last ? winnerOf(last) : null
  const mine = last ? myTeamName(last, team) : null
  const result = !last || !w ? null : w === "empate" ? "Empate" : mine ? ((w === "a") === (team === "a") ? "Sua equipe venceu" : "Sua equipe perdeu") : `Vitória da ${brief(w === "a" ? last.team_a : last.team_b)}`
  return (
    <CardResumo title="Último jogo" icon={Flag} action={last && <span className="text-[11px] text-muted-foreground tabular-nums">{shortDate(last.match_date)}</span>}>
      {!last ? <EmptyLine>Nenhum jogo registrado ainda.</EmptyLine> : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
            <div className="min-w-0 text-sm"><span aria-hidden className={cn("mx-auto mb-1 block size-3 rounded-full", teamDot(last.team_a))} /><span className={cn("block truncate", w === "a" && "font-semibold")}>{last.team_a}</span></div>
            <p className="text-3xl font-bold text-primary tabular-nums" aria-label={`Placar ${last.score_a ?? 0} a ${last.score_b ?? 0}`}>{last.score_a ?? "–"} <span className="text-muted-foreground">×</span> {last.score_b ?? "–"}</p>
            <div className="min-w-0 text-sm"><span aria-hidden className={cn("mx-auto mb-1 block size-3 rounded-full", teamDot(last.team_b))} /><span className={cn("block truncate", w === "b" && "font-semibold")}>{last.team_b}</span></div>
          </div>
          {result && <p className="text-center text-sm font-medium text-primary">{result}</p>}
        </div>
      )}
    </CardResumo>
  )
}

/* ───────── Ranking de artilharia ───────── */
const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

export function RankingArtilharia({ top, myId, stats }: { top: Scorer[]; myId: string; stats: ScorerStats | null }) {
  const mine = top.find((r) => r.athlete_id === myId)
  return (
    <CardResumo title="Artilharia" icon={Trophy}>
      {top.length === 0 ? <EmptyLine>Ainda não há gols registrados nesta temporada. ⚽</EmptyLine> : (
        <ol className="space-y-1.5">
          {top.map((r) => {
            const me = r.athlete_id === myId
            return (
              <li key={r.athlete_id} aria-current={me ? "true" : undefined}
                className={cn("flex items-center gap-3 rounded-xl px-2.5 py-2", me ? "bg-primary/10 ring-1 ring-primary/30" : r.pos === 1 ? "bg-amber-50" : "")}>
                <span className="w-7 shrink-0 text-center text-sm font-semibold text-muted-foreground" aria-label={`${r.pos}º lugar`}>{MEDAL[r.pos] ?? `${r.pos}º`}</span>
                <span className={cn("min-w-0 flex-1 truncate text-sm", (me || r.pos === 1) && "font-semibold")}>{r.display_name}{me && <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-white">você</span>}</span>
                <span className="shrink-0 text-sm font-bold text-primary tabular-nums">{goalsWord(r.goals)}</span>
              </li>
            )
          })}
        </ol>
      )}
      {stats && (
        <p className={cn("mt-3 rounded-lg px-3 py-2 text-xs", mine || stats.position ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground")}>
          {stats.position ? <>Sua posição: <b>{stats.position}º lugar</b> · {goalsWord(stats.goals)}</> : "Você ainda não marcou gols nesta temporada."}
        </p>
      )}
    </CardResumo>
  )
}

/* ───────── Aniversariantes ───────── */
export function ListaAniversariantes({ list }: { list: MonthBirthday[] }) {
  const today = brToday()
  const month = monthNameOf(today).charAt(0) + monthNameOf(today).slice(1).toLowerCase()
  return (
    <CardResumo title={`Aniversariantes de ${month}`} icon={Cake}>
      {list.length === 0 ? <EmptyLine>Nenhum aniversariante neste mês. 🎈</EmptyLine> : (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {list.map((b) => (
            <li key={b.display_name + b.bday} className={cn("flex items-center gap-3 rounded-xl px-2 py-1.5", b.is_today && "bg-[#EF3028]/5")}>
              <AvatarAtleta name={b.display_name} size="sm" className={b.is_today ? "bg-[#EF3028] ring-0" : "bg-secondary text-primary ring-0"} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{b.display_name}</span><span className="block text-[11px] text-muted-foreground">{b.turning_age} anos</span></span>
              <span className="shrink-0 text-xs font-medium tabular-nums">{String(b.bday).padStart(2, "0")}/{String(b.bmonth).padStart(2, "0")}{b.is_today && " 🎂"}</span>
            </li>
          ))}
        </ul>
      )}
    </CardResumo>
  )
}

/* ───────── Meus jogos ───────── */
function resultOf(g: MyGame): { label: string; cls: string } | null {
  const w = winnerOf(g.match)
  if (!w || (g.team !== "a" && g.team !== "b")) return null
  if (w === "empate") return { label: "Empate", cls: "bg-slate-200 text-slate-700" }
  return (w === g.team) ? { label: "Vitória", cls: "bg-green-600/10 text-green-800" } : { label: "Derrota", cls: "bg-[#EF3028]/10 text-[#B4151B]" }
}

export function HistoricoJogos({ games, limit, onSeeAll }: { games: MyGame[]; limit?: number; onSeeAll?: () => void }) {
  const shown = limit ? games.slice(0, limit) : games
  return (
    <CardResumo title="Meus jogos" icon={CalendarClock}>
      {games.length === 0 ? <EmptyLine>Nenhum jogo registrado ainda.</EmptyLine> : (
        <>
          <ul className="divide-y md:hidden">
            {shown.map((g) => {
              const r = resultOf(g)
              return (
                <li key={g.match.id} className="space-y-1 py-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="tabular-nums">{shortDate(g.match.match_date)}</span>{r && <span className={cn("rounded-full px-2 py-0.5 font-medium", r.cls)}>{r.label}</span>}</div>
                  <p className="text-sm font-medium">{brief(g.match.team_a)} <span className="tabular-nums">{g.match.score_a} × {g.match.score_b}</span> {brief(g.match.team_b)}</p>
                  <p className="flex items-center justify-between text-xs text-muted-foreground"><span>{myTeamName(g.match, g.team) ? `Sua equipe: ${brief(myTeamName(g.match, g.team)!)}` : ""}</span><span className="font-semibold text-primary">⚽ {goalsWord(g.goals)}</span></p>
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">Data</th><th className="py-2 pr-3 font-medium">Equipe</th><th className="py-2 pr-3 font-medium">Adversário</th><th className="py-2 pr-3 font-medium">Resultado</th><th className="py-2 text-right font-medium">Meus gols</th></tr></thead>
              <tbody className="divide-y">
                {shown.map((g) => {
                  const mine = myTeamName(g.match, g.team)
                  const other = g.team === "a" ? g.match.team_b : g.team === "b" ? g.match.team_a : null
                  const r = resultOf(g)
                  return (
                    <tr key={g.match.id}>
                      <td className="py-2.5 pr-3 tabular-nums">{shortDate(g.match.match_date)}</td>
                      <td className="py-2.5 pr-3">{mine ? brief(mine) : <span className="text-muted-foreground">{brief(g.match.team_a)} × {brief(g.match.team_b)}</span>}</td>
                      <td className="py-2.5 pr-3">{other ? brief(other) : "—"}</td>
                      <td className="py-2.5 pr-3"><span className="font-semibold tabular-nums">{g.match.score_a} × {g.match.score_b}</span>{r && <span className={cn("ml-2 rounded-full px-2 py-0.5 text-xs font-medium", r.cls)}>{r.label}</span>}</td>
                      <td className="py-2.5 text-right font-semibold text-primary tabular-nums">⚽ {goalsWord(g.goals)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {limit && games.length > limit && onSeeAll && <Button type="button" variant="outline" className="mt-3 h-11 w-full" onClick={onSeeAll}>Ver todos os jogos ({games.length})</Button>}
        </>
      )}
    </CardResumo>
  )
}

/* ───────── Financeiro ───────── */
export function ListaMensalidades({ charges, pix, onPay }: { charges: Charge[]; pix: Map<string, PixOption>; onPay: (o: PixOption) => void }) {
  return (
    <CardResumo title="Mensalidades" icon={CircleDollarSign}>
      {charges.length === 0 ? <EmptyLine>Nenhuma mensalidade gerada ainda.</EmptyLine> : (
        <ul className="divide-y">
          {charges.map((c) => {
            const o = c.balance > 0 ? pix.get(c.id) : undefined
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                <div className="min-w-0"><p className="text-sm font-medium capitalize">{formatCompetence(c.competence)}</p><p className="text-xs text-muted-foreground">Vence em {formatDate(c.due_date)}</p></div>
                <div className="flex items-center gap-3"><span className="text-sm font-semibold tabular-nums">{formatBRL(c.amount)}</span><StatusBadge status={c.display_status} />
                  {o && <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => onPay(o)}><QrCode /> Pagar</Button>}</div>
              </li>
            )
          })}
        </ul>
      )}
    </CardResumo>
  )
}

export function HistoricoPagamentos({ payments, charges }: { payments: Payment[]; charges: Charge[] }) {
  const ref = new Map(charges.map((c) => [c.id, c.competence]))
  return (
    <CardResumo title="Histórico de pagamentos" icon={Wallet}>
      {payments.length === 0 ? <EmptyLine>Nenhum pagamento registrado até o momento.</EmptyLine> : (
        <>
          <ul className="divide-y md:hidden">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                <div><p className="text-sm font-medium capitalize">{ref.has(p.charge_id) ? formatCompetence(ref.get(p.charge_id)!) : "Pagamento"}</p><p className="text-xs text-muted-foreground tabular-nums">{formatDate(p.paid_at)}</p></div>
                <div className="flex items-center gap-2"><span className="text-sm font-semibold tabular-nums">{formatBRL(p.amount)}</span><StatusBadge status="pago" /></div>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">Referência</th><th className="py-2 pr-3 font-medium">Valor</th><th className="py-2 pr-3 font-medium">Data</th><th className="py-2 font-medium">Situação</th></tr></thead>
              <tbody className="divide-y">
                {payments.map((p) => (
                  <tr key={p.id}><td className="py-2.5 pr-3 capitalize">{ref.has(p.charge_id) ? formatCompetence(ref.get(p.charge_id)!) : "—"}</td><td className="py-2.5 pr-3 tabular-nums">{formatBRL(p.amount)}</td><td className="py-2.5 pr-3 tabular-nums">{formatDate(p.paid_at)}</td><td className="py-2.5"><StatusBadge status="pago" /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </CardResumo>
  )
}

/* ───────── Perfil ───────── */
export function PerfilAtleta({ athlete, onEdit }: { athlete: Athlete; onEdit: () => void }) {
  const rows: [string, string][] = [
    ["Nome completo", athlete.full_name],
    ["Apelido", athlete.nickname || "—"],
    ["Nascimento", athlete.birth_date ? formatDate(athlete.birth_date) : "—"],
    ["WhatsApp", athlete.phone ? `+${athlete.phone}` : "—"],
    ["E-mail", athlete.email || "—"],
    ["Situação", athlete.active ? "Ativo" : "Inativo"],
    ["Membro desde", formatDate(athlete.joined_at)],
    ["Mensalidade", `${formatBRL(athlete.monthly_fee)} · vence dia ${athlete.due_day}`],
  ]
  return (
    <section aria-label="Meu perfil" className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-4">
        <AvatarAtleta name={athlete.nickname || athlete.full_name} size="lg" />
        <div className="min-w-0 flex-1"><h2 className="text-lg leading-snug font-bold break-words">{athlete.full_name}</h2>{athlete.nickname && <p className="text-sm text-muted-foreground">Apelido: {athlete.nickname}</p>}</div>
        <Button type="button" variant="outline" className="h-11" onClick={onEdit}><Pencil /> Editar perfil</Button>
      </div>
      <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b pb-2 sm:block sm:border-0 sm:pb-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="min-w-0 text-right font-medium break-words sm:text-left">{v}</dd></div>)}
      </dl>
    </section>
  )
}

/* ───────── Pagamento Pix ───────── */
export function PixDialog({ option, onClose }: { option: PixOption | null; onClose: () => void }) {
  const copy = (code: string) => navigator.clipboard.writeText(code).then(() => toast.success("Pix Copia e Cola copiado."), () => toast.error("Não foi possível copiar."))
  return (
    <Dialog open={!!option} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto">
        {option && (
          <>
            <DialogHeader>
              <DialogTitle>Pagar com Pix</DialogTitle>
              <DialogDescription className="capitalize">{formatCompetence(option.competence)} · {formatBRL(option.cents / 100)}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-center">
              {option.qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={option.qr} alt={`QR Code Pix da mensalidade de ${formatCompetence(option.competence)}`} width={220} height={220} className="mx-auto size-[220px] rounded-xl border bg-white p-2" />
              )}
              <div className="flex flex-col gap-2">
                {option.code && <Button type="button" className="h-11" onClick={() => copy(option.code!)}><Copy /> Copiar código Pix</Button>}
                {option.link && <a href={option.link} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium hover:bg-secondary"><ExternalLink className="size-4" /> Abrir link de pagamento</a>}
              </div>
              <p className="text-xs text-muted-foreground">{option.confirmedAuto
                ? "Depois de pagar, a confirmação é automática: sua mensalidade passa para “Pago” em instantes."
                : "Pague pelo app do seu banco. A Diretoria confere o pagamento e a mensalidade passa para “Pago” depois da conferência (não é instantâneo)."}</p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
