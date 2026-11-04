"use client"

import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { CalendarCheck, FileUp, LayoutDashboard, LogOut, UserPlus, Users, Wallet } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/atletas", label: "Atletas", icon: Users },
  { href: "/mensalidades", label: "Mensalidades", icon: CalendarCheck },
  { href: "/caixa", label: "Caixa", icon: Wallet },
  { href: "/cadastros", label: "Cadastros", icon: UserPlus },
  { href: "/importar", label: "Importar", icon: FileUp },
]

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const [pending, setPending] = React.useState(0)
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
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span aria-hidden>⚽</span> GEAB <span className="font-normal text-green-200">Financeiro</span>
          </div>
          <nav className="ml-2 flex flex-1 gap-1 overflow-x-auto" aria-label="Principal">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href)
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-green-100/80 hover:bg-white/10 hover:text-white", active && "bg-white/15 text-white")}
                >
                  <n.icon className="size-4" />
                  <span className="hidden sm:inline">{n.label}</span>
                  {n.href === "/cadastros" && pending > 0 && (
                    <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-black" aria-label={`${pending} pendentes`}>{pending}</span>
                  )}
                </Link>
              )
            })}
          </nav>
          <Button variant="ghost" size="sm" onClick={signOut} className="text-green-100 hover:bg-white/10 hover:text-white">
            <LogOut /> <span className="hidden sm:inline">Sair</span>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </div>
  )
}
