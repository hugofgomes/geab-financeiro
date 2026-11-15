"use client"

import { Menu } from "@base-ui/react/menu"
import { AppFooter } from "@/components/app-footer"
import { BirthdayCard } from "@/components/birthday-card"
import { AnnouncementBanner } from "@/components/announcement-banner"
import { InstallBanner } from "@/components/pwa"
import { useCourtRole } from "@/hooks/use-court-role"
import { SpyBanner } from "@/components/spy-banner"
import { SidePanel } from "@/components/side-panel"
import { TrialBanner } from "@/components/trial-banner"
import { isBirthday, markSeen, seenToday } from "@/lib/birthday"
import { useOrg } from "@/hooks/use-org"
import { useRole } from "@/hooks/use-role"
import { ROLE_LABEL, isAdminOnlyPath } from "@/lib/roles"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Clock, Activity, BookOpen, Bell, CalendarRange, ChartColumn, ClipboardList, Contact, Hourglass, LayoutDashboard, MapPin, Megaphone, Settings2, Wallet, Building2, CreditCard, Crown, PanelLeftClose, PanelLeftOpen, Globe, Play, CalendarCheck, ChevronDown, Trophy, FileUp, LogOut, Menu as MenuIcon, Radio, ReceiptText, Shirt, ShieldCheck, UserCog, UserPlus, Users, X } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import * as React from "react"
import { createPortal } from "react-dom"

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/atletas", label: "Atletas", icon: Users, ready: true },
  { href: "/mensalidades", label: "Mensalidades", icon: CalendarCheck },
  { href: "/caixa", label: "Caixa", icon: Wallet },
  { href: "/extrato", label: "Extrato", icon: ReceiptText },
  { href: "/jogos", label: "Jogos", icon: Trophy },
  { href: "/ao-vivo", label: "Gols ao vivo", icon: Radio },
  { href: "/escalacao", label: "Escalação", icon: Shirt },
  { href: "/cadastros", label: "Cadastros", icon: UserPlus },
]

const ADMIN = [
  { href: "/grupo", label: "Meu grupo", icon: Building2 },
  { href: "/importar", label: "Importar planilha", icon: FileUp },
  { href: "/usuarios", label: "Usuários e privilégios", icon: ShieldCheck },
  { href: "/assinatura", label: "Assinatura", icon: CreditCard },
]

/** Módulo Quadra Esportiva. Itens sem `ready` ainda não existem (chegam nas próximas fases) e aparecem desativados. */
const QUADRA = [
  { href: "/quadra", label: "Dashboard", icon: LayoutDashboard, ready: true },
  { href: "/quadra/agenda", label: "Agenda de Quadras", icon: CalendarRange, ready: true },
  { href: "/quadra/centro", label: "Centro Esportivo", icon: MapPin, ready: true },
  { href: "/quadra/reservas", label: "Reservas", icon: ClipboardList, ready: true },
  { href: "/quadra/espera", label: "Lista de Espera", icon: Hourglass, ready: true },
  { href: "/quadra/clientes", label: "Clientes", icon: Contact, ready: true },
  { href: "/quadra/funcionarios", label: "Funcionários", icon: Users, ready: true },
  { href: "/quadra/financeiro", label: "Financeiro", icon: Wallet, ready: true },
  { href: "/quadra/relatorios", label: "Relatórios", icon: ChartColumn, ready: true },
  { href: "/quadra/configuracoes", label: "Configurações", icon: Settings2, ready: true },
]

const ACCOUNT = { href: "/conta", label: "Minha conta", icon: UserCog }

const isActive = (path: string, href: string) => (href === "/" || href === "/quadra" ? path === href : path === href || path.startsWith(href + "/"))
const PLATFORM = { href: "/super", label: "Painel do SaaS", icon: Crown }
const SAAS_LINKS = [{ href: "/super/acessos", label: "Log de acessos", icon: Activity }, { href: "/super/comunicados", label: "Comunicados", icon: Megaphone }, { href: "/super/documentacao", label: "Documentação", icon: BookOpen }, { href: "/site", label: "Site comercial", icon: Globe }, { href: "/demo", label: "Demonstração", icon: Play }]
const titleOf = (path: string) => [...NAV, ...ADMIN, ...QUADRA, ...SAAS_LINKS, PLATFORM, ACCOUNT].filter((n) => isActive(path, n.href)).sort((a, b) => b.href.length - a.href.length)[0]?.label ?? ""

const itemCls = "flex w-full cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"

const CollapsedCtx = React.createContext(false)

function SignOutButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const { handlers, tip } = useTip("Sair", collapsed)
  return (
    <>
      <button type="button" onClick={onClick} aria-label="Sair" {...handlers}
        className={cn("flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/75 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70", collapsed && "lg:justify-center lg:px-0")}>
        <LogOut className="size-[18px]" aria-hidden /> <span className={cn(collapsed && "lg:sr-only")}>Sair</span>
      </button>
      {tip}
    </>
  )
}

/** Dica ao lado do ícone quando o menu está recolhido (portal: não é cortada pela rolagem do menu). */
function useTip(label: string, enabled: boolean) {
  const [y, setY] = React.useState<number | null>(null)
  const show = (e: React.SyntheticEvent<HTMLElement>) => { if (enabled) { const r = e.currentTarget.getBoundingClientRect(); setY(r.top + r.height / 2) } }
  const hide = () => setY(null)
  const tip = y != null && typeof document !== "undefined" && createPortal(
    <span role="tooltip" style={{ top: y }} className="pointer-events-none fixed left-[76px] z-[60] -translate-y-1/2 rounded-md bg-[#0F2540] px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white shadow-lg max-lg:hidden">{label}</span>, document.body)
  return { handlers: { onMouseEnter: show, onFocus: show, onMouseLeave: hide, onBlur: hide }, tip }
}

/** Submenu Quadra Esportiva (recolhível). Itens ainda não entregues aparecem desativados, com a marca "em breve". */
function QuadraMenu({ path }: { path: string }) {
  const collapsed = React.useContext(CollapsedCtx)
  const [open, setOpen] = React.useState(path.startsWith("/quadra"))
  React.useEffect(() => { if (path.startsWith("/quadra")) setOpen(true) }, [path])
  const { handlers, tip } = useTip("Quadra Esportiva", collapsed)
  const show = open || collapsed
  return (
    <div className="space-y-1">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={show} aria-controls="submenu-quadra" {...handlers}
        className={cn("flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-white outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70", collapsed && "lg:justify-center lg:px-0")}>
        <LayoutDashboard className="size-[18px] shrink-0" aria-hidden />
        <span className={cn("flex-1 truncate text-left", collapsed && "lg:sr-only")}>Quadra Esportiva</span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform", show && "rotate-180", collapsed && "lg:hidden")} />
      </button>
      {tip}
      <div id="submenu-quadra" className={cn("space-y-1", !show && "hidden", !collapsed && "border-l border-white/10 pl-2 ml-4")}>
        {QUADRA.map((n) => n.ready
          ? <SideLink key={n.href} {...n} path={path} />
          : (
            <div key={n.href} aria-disabled className={cn("flex h-10 cursor-not-allowed items-center gap-3 rounded-lg px-3 text-sm text-white/35", collapsed && "lg:justify-center lg:px-0")} title="Disponível nas próximas etapas">
              <n.icon className="size-[18px] shrink-0" aria-hidden />
              <span className={cn("flex-1 truncate", collapsed && "lg:sr-only")}>{n.label}</span>
              <Clock aria-label="em breve" className={cn("size-3.5 shrink-0 text-white/40", collapsed && "lg:hidden")} />
            </div>
          ))}
      </div>
    </div>
  )
}

function SideLink({ href, label, icon: Icon, path, badge }: { href: string; label: string; icon: typeof Users; path: string; badge?: number }) {
  const active = isActive(path, href)
  const collapsed = React.useContext(CollapsedCtx)
  const { handlers, tip } = useTip(label, collapsed)
  return (
    <>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        {...handlers}
        className={cn(
          "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/75 outline-none transition-all duration-150 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70",
          collapsed && "lg:justify-center lg:px-0",
          active && "bg-[var(--shell-active,#EF3028)] text-[var(--shell-active-fg,#fff)] shadow-sm hover:bg-[var(--shell-active,#EF3028)]",
        )}
      >
        <Icon className="size-[18px] shrink-0" aria-hidden />
        <span className={cn("flex-1 truncate", collapsed && "lg:sr-only")}>{label}</span>
        {!!badge && <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", active ? "bg-white text-[#EF3028]" : "bg-[#EF3028] text-white", collapsed && "lg:absolute lg:top-1 lg:right-2 lg:px-1 lg:text-[10px]")} aria-label={`${badge} pendentes`}>{badge}</span>}
      </Link>
      {tip}
    </>
  )
}

function UserMenu({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const router = useRouter()
  const first = name.split(" ")[0]
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Menu do usuário"
        className="flex h-10 shrink-0 items-center gap-2 rounded-lg px-2 text-sm text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-secondary"
      >
        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-primary text-xs font-semibold text-white uppercase">{first[0] ?? "D"}</span>
        <span className="hidden max-w-32 truncate font-medium sm:inline">{first || "Diretoria"}</span>
        <ChevronDown className="size-4 opacity-60" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={8} className="z-50">
          <Menu.Popup className="min-w-56 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            <div className="px-2.5 py-2">
              <div className="truncate text-sm font-medium">{name || "Diretoria"}</div>
              <div className="text-xs text-muted-foreground">Diretoria</div>
            </div>
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.Item onClick={() => router.push(ACCOUNT.href)} className={itemCls}>
              <ACCOUNT.icon className="size-4 text-muted-foreground" /> {ACCOUNT.label}
            </Menu.Item>
            <Menu.Item onClick={onSignOut} className={cn(itemCls, "text-[#B4151B] data-[highlighted]:bg-[#EF3028]/10 data-[highlighted]:text-[#B4151B]")}>
              <LogOut className="size-4" /> Sair
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const org = useOrg()
  const courtRole = useCourtRole()
  const goto = useRouter()
  const isCenter = org?.kind === "quadra"
  const { role } = useRole()
  const readOnly = role !== "admin"      // Diretoria (e enquanto o nível carrega): sem controles de edição
  const [isPlatform, setIsPlatform] = React.useState(false)
  const [mods, setMods] = React.useState<string[] | null>(null)   // módulos do plano (nulo = ainda carregando: mostra tudo)
  React.useEffect(() => { if (isCenter && path === "/") goto.replace("/quadra") }, [isCenter, path, goto])
  React.useEffect(() => { supabase().rpc("my_modules").then((r) => setMods(Array.isArray(r.data) ? (r.data as string[]) : null), () => {}) }, [])
  React.useEffect(() => { supabase().rpc("is_platform_admin").then((r) => setIsPlatform(r.data === true), () => {}) }, [])
  const [open, setOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)
  React.useEffect(() => { try { setCollapsed(localStorage.getItem("geab.menu.recolhido") === "1") } catch {} }, [])
  const toggleMenu = () => setCollapsed((c) => { try { localStorage.setItem("geab.menu.recolhido", c ? "0" : "1") } catch {} return !c })
  const [pending, setPending] = React.useState(0)
  const [birthdays, setBirthdays] = React.useState<string[]>([])
  const [me, setMe] = React.useState("")
  React.useEffect(() => {
    const sb = supabase()
    sb.auth.getUser().then(({ data }) =>
      data.user ? sb.from("profiles").select("full_name").eq("id", data.user.id).maybeSingle().then((r) => setMe((r.data?.full_name as string | undefined) ?? "")) : undefined, () => {})
  }, [])
  React.useEffect(() => {
    if (seenToday("admin")) return
    supabase().from("athletes").select("full_name, nickname, birth_date").eq("active", true).not("birth_date", "is", null)
      .then((r) => {
        const names = ((r.data ?? []) as { full_name: string; nickname: string | null; birth_date: string }[])
          .filter((a) => isBirthday(a.birth_date))
          .map((a) => a.nickname ? `${a.full_name} (${a.nickname})` : a.full_name)
        if (names.length) setBirthdays(names)
      }, () => {})
  }, [])
  React.useEffect(() => {
    supabase().from("signup_requests").select("id", { count: "exact", head: true }).eq("status", "pendente")
      .then((r) => setPending(r.count ?? 0), () => {})
  }, [path])
  const signOut = async () => {
    await supabase().auth.signOut()
    window.location.href = "/login"
  }
  // Fecha o menu lateral ao navegar ou pressionar Esc (telas pequenas).
  React.useEffect(() => { setOpen(false) }, [path])
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])
  return (
    <CollapsedCtx.Provider value={collapsed}>
    <div className={cn("flex min-h-dvh flex-col", (isCenter || path.startsWith("/quadra")) && "quadra-theme")}>
      {open && <div className="fixed inset-0 z-30 bg-[#0f2540]/50 backdrop-blur-[1px] lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        id="menu-lateral"
        aria-label="Menu principal"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-[var(--shell-bg,#1E3A5F)] text-white shadow-xl transition-[transform,width] duration-200 ease-out motion-reduce:transition-none lg:translate-x-0 lg:shadow-none",
          collapsed && "lg:w-[72px]",
          open ? "translate-x-0" : "max-lg:invisible max-lg:-translate-x-full",
        )}
      >
        <div className={cn("flex h-16 items-center justify-between border-b border-white/10 px-5", collapsed && "lg:justify-center lg:px-0")}>
          <span className="flex min-w-0 items-center gap-2">
            {org?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo_url} alt="" className="h-8 w-auto max-w-10 shrink-0 object-contain" />
            )}
            <span className={cn("truncate text-[15px] font-bold tracking-[0.14em] uppercase", collapsed && "lg:hidden")}>{org?.name ?? "\u00a0"}</span>
            {collapsed && !org?.logo_url && <span aria-hidden className="hidden size-9 place-items-center rounded-lg bg-white/10 text-sm font-bold lg:grid">{(org?.name ?? "G")[0]}</span>}
          </span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Fechar menu" className="grid size-10 place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white lg:hidden">
            <X className="size-5" />
          </button>
        </div>
        <nav className={cn("flex-1 space-y-6 overflow-y-auto px-3 py-5", collapsed && "lg:space-y-3")} aria-label="Principal">
          {courtRole && <QuadraMenu path={path} />}
          {!isCenter && <div className="space-y-1">
            <p className={cn("px-3 pb-1 text-[11px] font-semibold tracking-wider text-white/50 uppercase", collapsed && "lg:hidden")}>Gestão</p>
            {NAV.filter((n) => (role === "admin" || !isAdminOnlyPath(n.href)) && (!mods || !((n.href === "/ao-vivo" && !mods.includes("ao_vivo"))))).map((n) => <SideLink key={n.href} {...n} path={path} badge={n.href === "/cadastros" ? pending : undefined} />)}
          </div>}
          <div className="space-y-1">
            <p className={cn("px-3 pb-1 text-[11px] font-semibold tracking-wider text-white/50 uppercase", collapsed && "lg:hidden")}>{role === "admin" ? "Administração" : "Conta"}</p>
            {role === "admin" && ADMIN.filter((n) => (!isCenter || n.href === "/assinatura") && (!mods || n.href !== "/importar" || mods.includes("importar"))).map((n) => <SideLink key={n.href} {...n} path={path} />)}
            <SideLink {...ACCOUNT} path={path} />
          </div>
          {role === "admin" && isPlatform && (
            <div className="space-y-1">
              <p className={cn("px-3 pb-1 text-[11px] font-semibold tracking-wider text-white/50 uppercase", collapsed && "lg:hidden")}>SaaS</p>
              <SideLink {...PLATFORM} path={path} />
              {SAAS_LINKS.map((n) => <SideLink key={n.href} {...n} path={path} />)}
            </div>
          )}
        </nav>
        <div className="space-y-1 border-t border-white/10 p-3">
          <button type="button" onClick={toggleMenu} aria-pressed={collapsed} aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            className={cn("hidden h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/70 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 lg:flex", collapsed && "lg:justify-center lg:px-0")}>
            {collapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden /> : <><PanelLeftClose className="size-[18px]" aria-hidden /> Recolher menu</>}
          </button>
          <SignOutButton collapsed={collapsed} onClick={signOut} />
        </div>
      </aside>

      <div className={cn("flex min-h-dvh flex-1 flex-col transition-[padding] duration-200 motion-reduce:transition-none", collapsed ? "lg:pl-[72px]" : "lg:pl-64")}>
        <header className="sticky top-0 z-20 flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-3 border-b bg-white px-4 pt-[env(safe-area-inset-top)] shadow-sm sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={open}
            aria-controls="menu-lateral"
            className="grid size-10 place-items-center rounded-lg text-primary outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <MenuIcon className="size-5" />
          </button>
          <div className="flex-1 truncate text-lg font-semibold tracking-tight text-primary">{titleOf(path)}</div>
          <Link
            href="/cadastros"
            aria-label={pending > 0 ? `Notificações: ${pending} cadastro(s) pendente(s)` : "Notificações: nenhuma pendência"}
            title={pending > 0 ? `${pending} cadastro(s) aguardando aprovação` : "Sem pendências"}
            className="relative grid size-10 place-items-center rounded-lg text-primary outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell className="size-5" />
            {pending > 0 && <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-[#EF3028] px-1 text-[10px] leading-4 font-semibold text-white">{pending}</span>}
          </Link>
          <UserMenu name={me} onSignOut={signOut} />
        </header>
        <div className="mx-auto flex w-full max-w-[90rem] flex-1 flex-col gap-6 px-4 py-6 sm:px-6 xl:flex-row">
          <main className="min-w-0 flex-1 space-y-6" data-readonly={readOnly ? "" : undefined}>
            <SpyBanner />
            <InstallBanner />
            <AnnouncementBanner />
            {role === "admin" && <TrialBanner />}
            {role === "diretoria" && <p role="note" className="rounded-lg border bg-secondary px-3 py-2 text-xs text-muted-foreground">Acesso de consulta ({ROLE_LABEL.diretoria}): você vê todas as áreas, mas não altera dados nem acessa a administração.</p>}
            {children}
          </main>
          {!isCenter && !path.startsWith("/quadra") && <SidePanel />}
        </div>
        <AppFooter />
      </div>
      <BirthdayCard names={birthdays} self={false} onClose={() => { markSeen("admin"); setBirthdays([]) }} />
    </div>
    </CollapsedCtx.Provider>
  )
}
