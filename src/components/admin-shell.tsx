"use client"

import { Menu } from "@base-ui/react/menu"
import { BirthdayCard } from "@/components/birthday-card"
import { isBirthday, markSeen, seenToday } from "@/lib/birthday"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { CalendarCheck, ChevronDown, FileUp, LayoutDashboard, LogOut, ShieldCheck, UserCog, UserPlus, Users, Wallet } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import * as React from "react"

/** Uso diário: ficam sempre visíveis na barra. */
const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/atletas", label: "Atletas", icon: Users },
  { href: "/mensalidades", label: "Mensalidades", icon: CalendarCheck },
  { href: "/caixa", label: "Caixa", icon: Wallet },
  { href: "/cadastros", label: "Cadastros", icon: UserPlus },
]

/** Administração e conta: ficam no menu do usuário. */
const MORE = [
  { href: "/importar", label: "Importar planilha", icon: FileUp },
  { href: "/usuarios", label: "Usuários e privilégios", icon: ShieldCheck },
  { href: "/conta", label: "Minha conta", icon: UserCog },
]

const itemCls = "flex w-full cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"

function UserMenu({ path, name, onSignOut }: { path: string; name: string; onSignOut: () => void }) {
  const router = useRouter()
  const inMore = MORE.some((m) => path.startsWith(m.href))
  const first = name.split(" ")[0]
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Menu do usuário"
        className={cn("flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm text-green-100 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 data-[popup-open]:bg-white/15", inMore && "bg-white/15 text-white")}
      >
        <span aria-hidden className="grid size-6 place-items-center rounded-full bg-white/20 text-xs font-semibold uppercase">{(first[0] ?? "D")}</span>
        <span className="hidden max-w-28 truncate md:inline">{first || "Diretoria"}</span>
        <ChevronDown className="size-4 opacity-70" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={8} className="z-50">
          <Menu.Popup className="min-w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            <div className="px-2.5 py-2">
              <div className="truncate text-sm font-medium">{name || "Diretoria"}</div>
              {name && <div className="text-xs text-muted-foreground">Diretoria</div>}
            </div>
            <Menu.Separator className="my-1 h-px bg-border" />
            {MORE.map((m) => (
              <Menu.Item key={m.href} onClick={() => router.push(m.href)} className={itemCls}>
                <m.icon className="size-4 text-muted-foreground" /> {m.label}
              </Menu.Item>
            ))}
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.Item onClick={onSignOut} className={cn(itemCls, "text-destructive data-[highlighted]:text-destructive")}>
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
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-[#0b3d1e] text-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:gap-4 sm:px-4">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span aria-hidden>⚽</span> GEAB <span className="hidden font-normal text-green-200 md:inline">Financeiro</span>
          </div>
          <nav className="flex flex-1 justify-center gap-0.5 overflow-x-auto sm:ml-2 sm:justify-start sm:gap-1 lg:overflow-visible" aria-label="Principal">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href)
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  title={n.label}
                  aria-label={n.label}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm sm:px-3 text-green-100/80 hover:bg-white/10 hover:text-white", active && "bg-white/15 text-white")}
                >
                  <n.icon className="size-4" />
                  <span className="hidden lg:inline">{n.label}</span>
                  {n.href === "/cadastros" && pending > 0 && (
                    <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-black" aria-label={`${pending} pendentes`}>{pending}</span>
                  )}
                </Link>
              )
            })}
          </nav>
          <UserMenu path={path} name={me} onSignOut={signOut} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
      <BirthdayCard names={birthdays} self={false} onClose={() => { markSeen("admin"); setBirthdays([]) }} />
    </div>
  )
}
