"use client"

import { Menu } from "@base-ui/react/menu"
import { CardDesempenho, CardMensalidade, CardProximoJogo, CardUltimoJogo, HistoricoJogos, HistoricoPagamentos, ListaAniversariantes, ListaMensalidades, PerfilAtleta, PixDialog, RankingArtilharia, currentCharge } from "@/components/atleta/cards"
import { EditDialog, PasswordDialog, type EditMode } from "@/components/atleta/conta"
import { useAthleteData, useExtras, usePixOptions, type PixOption } from "@/components/atleta/data"
import { ActiveBadge, AvatarAtleta, CardResumo, ErrorBox, brief } from "@/components/atleta/ui"
import { AppFooter } from "@/components/app-footer"
import { BirthdayCard } from "@/components/birthday-card"
import { SetupNotice } from "@/components/setup-notice"
import { Skeleton } from "@/components/ui/skeleton"
import { useOrg } from "@/hooks/use-org"
import { isBirthday, markSeen, seenToday } from "@/lib/birthday"
import { formatBRL, formatDate } from "@/lib/format"
import { brToday, hhmm, splitMatches, weekdayOf } from "@/lib/matches"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Bell, ChevronDown, KeyRound, LayoutDashboard, LogOut, Mail, Trophy, UserRound, Wallet, type LucideIcon } from "lucide-react"
import * as React from "react"

type Tab = "geral" | "jogos" | "financeiro" | "perfil"
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "geral", label: "Visão geral", icon: LayoutDashboard },
  { id: "jogos", label: "Jogos", icon: Trophy },
  { id: "financeiro", label: "Financeiro", icon: Wallet },
  { id: "perfil", label: "Perfil", icon: UserRound },
]
const isTab = (v: string): v is Tab => TABS.some((t) => t.id === v)
const itemCls = "flex w-full cursor-default items-center gap-2 rounded-md px-2.5 py-2.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"

function CardsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Carregando">
      <Skeleton className="h-36 rounded-2xl md:col-span-2" /><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-36 rounded-2xl md:col-span-2" />
    </div>
  )
}

export default function AthletePortal() {
  const org = useOrg()
  const { data, error, loading, reload } = useAthleteData()
  const extras = useExtras(data?.athlete.id)
  const ex = extras.data
  const pix = usePixOptions(data)

  const [tab, setTabState] = React.useState<Tab>("geral")
  const [pixOpt, setPixOpt] = React.useState<PixOption | null>(null)
  const [edit, setEdit] = React.useState<EditMode | null>(null)
  const [pwOpen, setPwOpen] = React.useState(false)
  const [showCard, setShowCard] = React.useState(false)

  // A aba fica no endereço (#jogos…): o botão voltar e os links funcionam.
  React.useEffect(() => {
    const read = () => { const h = window.location.hash.slice(1); setTabState(isTab(h) ? h : "geral") }
    read()
    window.addEventListener("hashchange", read)
    return () => window.removeEventListener("hashchange", read)
  }, [])
  const setTab = React.useCallback((t: Tab) => {
    setTabState(t)
    try { window.history.pushState(null, "", t === "geral" ? window.location.pathname : `#${t}`) } catch { /* ignore */ }
    window.scrollTo({ top: 0 })
  }, [])

  React.useEffect(() => {
    if (data && isBirthday(data.athlete.birth_date) && !seenToday(`atleta.${data.athlete.id}`)) setShowCard(true)
  }, [data])
  if (!supabaseConfigured) return <SetupNotice />

  const signOut = async () => { await supabase().auth.signOut(); window.location.href = "/login" }
  const a = data?.athlete
  const first = a ? a.nickname || a.full_name.split(" ")[0] : ""
  const unlinked = !!error && (error.includes("multiple") || error.includes("0 rows"))

  const matchesSplit = ex ? splitMatches(ex.matches) : null
  const next = matchesSplit?.next ?? null
  const last = matchesSplit?.last ?? null
  const teamOf = (m: { id: string } | null) => (m && ex ? ex.lineups.get(m.id) ?? null : null)
  // Equipe atual: a do próximo jogo (se já escalado) ou a do último jogo em que foi escalado.
  const currentTeamName = (() => {
    if (!ex) return null
    const m = (next && ex.lineups.get(next.id) && ex.lineups.get(next.id) !== "reserva" ? next : null) ?? ex.matches.find((x) => ex.lineups.get(x.id) === "a" || ex.lineups.get(x.id) === "b")
    const t = m ? ex.lineups.get(m.id) : null
    return m && (t === "a" || t === "b") ? brief(t === "a" ? m.team_a : m.team_b) : null
  })()

  // Avisos: só o que já está nos dados carregados.
  const notices: { text: string; go: Tab }[] = []
  if (data) {
    for (const c of data.charges.filter((x) => x.balance > 0).sort((x, y) => x.due_date.localeCompare(y.due_date)).slice(0, 3))
      notices.push({ text: c.display_status === "atrasado" ? `Mensalidade vencida em ${formatDate(c.due_date)}` : `Mensalidade vence em ${formatDate(c.due_date)}`, go: "financeiro" })
    if (next) { const days = Math.round((Date.parse(next.match_date + "T12:00:00Z") - Date.parse(brToday() + "T12:00:00Z")) / 86_400_000); if (days <= 2) notices.push({ text: `Jogo ${days <= 0 ? "hoje" : days === 1 ? "amanhã" : "em 2 dias"}: ${weekdayOf(next.match_date)}, ${hhmm(next.match_time) ?? "horário a definir"}`, go: "geral" }) }
    for (const b of ex?.birthdays.filter((x) => x.is_today) ?? []) notices.push({ text: `Hoje é aniversário de ${b.display_name}! 🎂`, go: "geral" })
  }

  const goalsBlock = ex && data && (
    <div className="space-y-4">
      <RankingArtilharia top={ex.top} myId={data.athlete.id} stats={ex.stats} />
      <ListaAniversariantes list={ex.birthdays} />
    </div>
  )
  const showAside = tab === "geral" || tab === "jogos"

  return (
    <div className="flex min-h-dvh flex-col bg-[#F5F7FA]">
      {/* Topo */}
      <header className="sticky top-0 z-30 bg-[#1E3A5F] text-white shadow-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 md:h-[72px]">
          <span className="truncate text-base font-bold tracking-wide uppercase md:text-lg">{org?.name ?? "GEAB Futebol"}</span>
          <div className="flex items-center gap-1 sm:gap-2">
            <Menu.Root>
              <Menu.Trigger aria-label={`Notificações${notices.length ? `: ${notices.length}` : ""}`} className="relative grid size-11 place-items-center rounded-full text-white/90 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 data-[popup-open]:bg-white/10">
                <Bell className="size-5" aria-hidden />
                {notices.length > 0 && <span aria-hidden className="absolute top-2 right-2 grid size-4 place-items-center rounded-full bg-[#EF3028] text-[10px] font-bold">{notices.length}</span>}
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner align="end" sideOffset={8} className="z-50">
                  <Menu.Popup className="w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                    <p className="px-2.5 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Avisos</p>
                    {notices.length === 0 ? <p className="px-2.5 pb-3 text-sm text-muted-foreground">Nenhum aviso no momento.</p> : notices.map((n, i) => (
                      <Menu.Item key={i} onClick={() => setTab(n.go)} className={cn(itemCls, "items-start")}>{n.text}</Menu.Item>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
            <Menu.Root>
              <Menu.Trigger aria-label="Menu do usuário" className="flex h-11 items-center gap-2 rounded-full pr-2 pl-1 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 data-[popup-open]:bg-white/10">
                <AvatarAtleta name={first || "?"} size="md" />
                <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">{first}</span>
                <ChevronDown className="size-4 opacity-70" aria-hidden />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner align="end" sideOffset={8} className="z-50">
                  <Menu.Popup className="min-w-56 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                    <div className="px-2.5 py-2"><div className="truncate text-sm font-medium">{a?.full_name}</div><div className="text-xs text-muted-foreground">Atleta</div></div>
                    <Menu.Separator className="my-1 h-px bg-border" />
                    <Menu.Item onClick={() => setTab("perfil")} className={itemCls}><UserRound className="size-4 text-muted-foreground" /> Meu perfil</Menu.Item>
                    <Menu.Item onClick={() => setPwOpen(true)} className={itemCls}><KeyRound className="size-4 text-muted-foreground" /> Alterar senha</Menu.Item>
                    <Menu.Item onClick={signOut} className={cn(itemCls, "text-[#B4151B] data-[highlighted]:bg-[#EF3028]/10 data-[highlighted]:text-[#B4151B]")}><LogOut className="size-4" /> Sair</Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </div>
        </div>
        {/* Navegação (computador) */}
        <nav aria-label="Seções" className="hidden border-t border-white/10 md:block">
          <div className="mx-auto flex max-w-6xl gap-1 px-4">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
                className={cn("flex h-11 items-center gap-2 border-b-2 px-4 text-sm font-medium outline-none transition-colors focus-visible:bg-white/10", tab === t.id ? "border-white text-white" : "border-transparent text-white/70 hover:text-white")}>
                <t.icon className="size-4" aria-hidden /> {t.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      {data && <BirthdayCard names={showCard ? [first] : []} self onClose={() => { markSeen(`atleta.${data.athlete.id}`); setShowCard(false) }} />}

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 pt-6 pb-8 md:pb-10">
        {error && (unlinked
          ? <ErrorBox>Seu usuário ainda não está vinculado a um atleta. Fale com a administração.</ErrorBox>
          : <ErrorBox onRetry={reload}>Não foi possível carregar os dados. Tente novamente.</ErrorBox>)}
        {loading && !data && <CardsSkeleton />}

        {a && data && (
          <>
            {/* Boas-vindas */}
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-[#1E3A5F] sm:text-3xl">Olá, {first}! 👋</h1>
                <p className="mt-1 text-sm text-muted-foreground">Confira seus jogos, pagamentos e desempenho no GEAB Futebol.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <ActiveBadge active={a.active} />
                <span className="rounded-full bg-white px-2.5 py-0.5 font-medium text-muted-foreground ring-1 ring-border">Membro desde {formatDate(a.joined_at)}</span>
                {currentTeamName && <span className="rounded-full bg-white px-2.5 py-0.5 font-medium text-muted-foreground ring-1 ring-border">Equipe {currentTeamName}</span>}
              </div>
            </div>

            {extras.error && !ex && <ErrorBox onRetry={extras.reload}>Não foi possível carregar jogos e ranking. Tente novamente.</ErrorBox>}
            {ex?.failed && <p className="text-xs text-muted-foreground">Algumas informações não puderam ser carregadas agora.</p>}

            <div className={cn("grid gap-6", showAside && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
              <div className="min-w-0 space-y-4">
                {tab === "geral" && (
                  ex ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <CardProximoJogo next={next} team={teamOf(next)} />
                      <CardMensalidade charges={data.charges} pix={pix} onPay={setPixOpt} onSeeAll={() => setTab("financeiro")} />
                      <CardDesempenho stats={ex.stats} />
                      <div className="md:col-span-2"><CardUltimoJogo last={last} team={teamOf(last)} /></div>
                    </div>
                  ) : <CardsSkeleton />
                )}
                {tab === "jogos" && (ex ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-2"><CardProximoJogo next={next} team={teamOf(next)} /><CardDesempenho stats={ex.stats} /><CardUltimoJogo last={last} team={teamOf(last)} /></div>
                    <HistoricoJogos games={ex.games} />
                  </>
                ) : <CardsSkeleton />)}
                {tab === "financeiro" && (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <CardMensalidade charges={data.charges} pix={pix} onPay={setPixOpt} onSeeAll={() => document.getElementById("mensalidades")?.scrollIntoView({ behavior: "smooth" })} />
                      <CardResumo title="Situação"><dl className="space-y-1.5 text-sm"><div className="flex justify-between"><dt className="text-muted-foreground">Mensalidade fixa</dt><dd className="font-medium">{formatBRL(a.monthly_fee)}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">Vencimento</dt><dd className="font-medium">todo dia {a.due_day}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">Em aberto</dt><dd className="font-medium">{currentCharge(data.charges).openCount}</dd></div></dl></CardResumo>
                    </div>
                    <div id="mensalidades" className="scroll-mt-32"><ListaMensalidades charges={data.charges} pix={pix} onPay={setPixOpt} /></div>
                    <HistoricoPagamentos payments={data.payments} charges={data.charges} />
                  </>
                )}
                {tab === "perfil" && (
                  <>
                    <PerfilAtleta athlete={a} onEdit={() => setEdit("perfil")} />
                    <CardResumo title="Minha conta">
                      <ul className="divide-y">
                        {([["Dados pessoais", "Nome e apelido", UserRound, () => setEdit("pessoais")], ["Contatos", "WhatsApp e e-mail", Mail, () => setEdit("contatos")], ["Alterar senha", "Troque a senha de acesso", KeyRound, () => setPwOpen(true)]] as [string, string, LucideIcon, () => void][]).map(([t, d, Icon, fn]) => (
                          <li key={t}><button type="button" onClick={fn} className="flex min-h-14 w-full items-center gap-3 rounded-lg py-2 text-left outline-none hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring">
                            <span aria-hidden className="grid size-10 place-items-center rounded-full bg-secondary text-primary"><Icon className="size-5" /></span>
                            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{t}</span><span className="block text-xs text-muted-foreground">{d}</span></span>
                            <ChevronDown className="size-4 -rotate-90 text-muted-foreground" aria-hidden />
                          </button></li>
                        ))}
                      </ul>
                    </CardResumo>
                  </>
                )}
              </div>
              {showAside && (ex && goalsBlock ? <aside aria-label="Artilharia e aniversariantes" className="min-w-0 lg:sticky lg:top-36 lg:self-start">{goalsBlock}</aside> : <Skeleton className="h-64 rounded-2xl" />)}
            </div>
          </>
        )}
      </main>

      <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0"><AppFooter /></div>

      {/* Navegação (celular) */}
      <nav aria-label="Seções" className="fixed inset-x-0 bottom-0 z-30 border-t bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,.06)] md:hidden">
        <ul className="grid grid-cols-4">
          {TABS.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
                className={cn("flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:bg-secondary", tab === t.id ? "text-primary" : "text-muted-foreground")}>
                <t.icon className={cn("size-6", tab === t.id && "stroke-[2.4]")} aria-hidden />{t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <PixDialog option={pixOpt} onClose={() => setPixOpt(null)} />
      {a && <EditDialog mode={edit} athlete={a} onClose={() => setEdit(null)} onSaved={reload} />}
      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  )
}
