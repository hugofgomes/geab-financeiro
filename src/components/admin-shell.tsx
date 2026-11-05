"use client"

import { Menu } from "@base-ui/react/menu"
import { BirthdayCard } from "@/components/birthday-card"
import { SidePanel } from "@/components/side-panel"
import { isBirthday, markSeen, seenToday } from "@/lib/birthday"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Bell, CalendarCheck, ChevronDown, Trophy, FileUp, LayoutDashboard, LogOut, Menu as MenuIcon, ReceiptText, ShieldCheck, UserCog, UserPlus, Users, Wallet, X } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import * as React from "react"

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/atletas", label: "Atletas", icon: Users },
  { href: "/mensalidades", label: "Mensalidades", icon: CalendarCheck },
  { href: "/caixa", label: "Caixa", icon: Wallet },
  { href: "/extrato", label: "Extrato", icon: ReceiptText },
  { href: "/jogos", label: "Jogos", icon: Trophy },
  { href: "/cadastros", label: "Cadastros", icon: UserPlus },
]

const ADMIN = [
  { href: "/importar", label: "Importar planilha", icon: FileUp },
  { href: "/usuarios", label: "Usuários e privilégios", icon: ShieldCheck },
]

const ACCOUNT = { href: "/conta", label: "Minha conta", icon: UserCog }

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"))
const titleOf = (path: string) => [...NAV, ...ADMIN, ACCOUNT].find((n) => isActive(path, n.href))?.label ?? "GEAB Futebol"

const itemCls = "flex w-full cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"

function SideLink({ href, label, icon: Icon, path, badge }: { href: string; label: string; icon: typeof Users; path: string; badge?: number }) {
  const active = isActive(path, href)
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/80 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70",
        active && "bg-[#F32329] text-white shadow-sm hover:bg-[#F32329]",
      )}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      {!!badge && <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", active ? "bg-white text-[#F32329]" : "bg-[#F32329] text-white")} aria-label={`${badge} pendentes`}>{badge}</span>}
    </Link>
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
            <Menu.Item onClick={onSignOut} className={cn(itemCls, "text-[#B4151B] data-[highlighted]:bg-[#F32329]/10 data-[highlighted]:text-[#B4151B]")}>
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
  const [open, setOpen] = React.useState(false)
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
    <div className="min-h-dvh">
      {open && <div className="fixed inset-0 z-30 bg-[#0f2540]/50 backdrop-blur-[1px] lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        id="menu-lateral"
        aria-label="Menu principal"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-[#1C3D63] text-white shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none lg:translate-x-0 lg:shadow-none",
          open ? "translate-x-0" : "max-lg:invisible max-lg:-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
          <span className="text-[15px] font-bold tracking-[0.14em] uppercase">GEAB Futebol</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Fechar menu" className="grid size-8 place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white lg:hidden">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label="Principal">
          <div className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-white/50 uppercase">Gestão</p>
            {NAV.map((n) => <SideLink key={n.href} {...n} path={path} badge={n.href === "/cadastros" ? pending : undefined} />)}
          </div>
          <div className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-white/50 uppercase">Administração</p>
            {ADMIN.map((n) => <SideLink key={n.href} {...n} path={path} />)}
            <SideLink {...ACCOUNT} path={path} />
          </div>
        </nav>
        <div className="border-t border-white/10 p-3">
          <button type="button" onClick={signOut} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/80 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70">
            <LogOut className="size-[18px]" aria-hidden /> Sair
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-white px-4 shadow-sm sm:px-6">
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
            {pending > 0 && <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-[#F32329] px-1 text-[10px] leading-4 font-semibold text-white">{pending}</span>}
          </Link>
          <UserMenu name={me} onSignOut={signOut} />
        </header>
        <div className="mx-auto flex max-w-[90rem] flex-col gap-6 px-4 py-6 sm:px-6 xl:flex-row">
          <main className="min-w-0 flex-1 space-y-6">{children}</main>
          <SidePanel />
        </div>
      </div>
      <BirthdayCard names={birthdays} self={false} onClose={() => { markSeen("admin"); setBirthdays([]) }} />
    </div>
  )
}
