"use client"

import { Logo } from "@/components/logo"
import { BirthdayCard } from "@/components/birthday-card"
import { SetupNotice } from "@/components/setup-notice"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useLoad } from "@/hooks/use-load"
import { isBirthday, markSeen, seenToday } from "@/lib/birthday"
import { formatBRL, formatCompetence, formatDate } from "@/lib/format"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Athlete, Charge, Payment } from "@/lib/types"
import { normalizePhone } from "@/lib/whatsapp"
import { Loader2, LogOut } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

export default function AthletePortal() {
  const { data, error, loading, reload } = useLoad(async () => {
    const sb = supabase()
    const [a, c, p] = await Promise.all([
      sb.from("athletes").select("*").single(),   // RLS: só o próprio cadastro
      sb.from("charges_view").select("*").order("competence", { ascending: false }),
      sb.from("payments").select("*").order("paid_at", { ascending: false }),
    ])
    for (const r of [a, c, p]) if (r.error) throw new Error(r.error.message)
    return { athlete: a.data as Athlete, charges: c.data as Charge[], payments: p.data as Payment[] }
  }, [])
  const [phone, setPhone] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [showCard, setShowCard] = React.useState(false)
  React.useEffect(() => {
    if (data && isBirthday(data.athlete.birth_date) && !seenToday(`atleta.${data.athlete.id}`)) setShowCard(true)
  }, [data])
  React.useEffect(() => { if (data) { setPhone(data.athlete.phone ? `+${data.athlete.phone}` : ""); setEmail(data.athlete.email ?? "") } }, [data])
  if (!supabaseConfigured) return <SetupNotice />

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase().rpc("update_my_contact", { p_phone: normalizePhone(phone), p_email: email.trim() || null })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Contato atualizado.")
    reload()
  }
  const signOut = async () => { await supabase().auth.signOut(); window.location.href = "/login" }

  return (
    <div className="min-h-dvh">
      <header className="border-b bg-[#0b3d1e] text-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4"><span className="flex items-center gap-2 font-semibold"><Logo size={34} /> GEAB Futebol</span>
          <Button variant="ghost" size="sm" onClick={signOut} className="text-green-100 hover:bg-white/10 hover:text-white"><LogOut /> Sair</Button></div>
      </header>
      {data && (
        <BirthdayCard
          names={showCard ? [data.athlete.nickname || data.athlete.full_name.split(" ")[0]] : []}
          self
          onClose={() => { markSeen(`atleta.${data.athlete.id}`); setShowCard(false) }}
        />
      )}
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {error && <p role="alert" className="text-sm text-destructive">{error.includes("multiple") || error.includes("0 rows") ? "Seu usuário ainda não está vinculado a um atleta. Fale com a administração." : `Erro ao carregar: ${error}`}</p>}
        {loading && !data && <Skeleton className="h-64" />}
        {data && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Olá, {data.athlete.nickname || data.athlete.full_name.split(" ")[0]}!</h1>
            <Card>
              <CardHeader><CardTitle className="text-base">Minhas mensalidades</CardTitle></CardHeader>
              <CardContent>
                {data.charges.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma mensalidade gerada.</p> : (
                  <ul className="divide-y text-sm">
                    {data.charges.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <span><span className="font-medium capitalize">{formatCompetence(c.competence)}</span> <span className="text-xs text-muted-foreground">· vence {formatDate(c.due_date)}</span></span>
                        <span className="flex items-center gap-3"><span className="tabular-nums">{formatBRL(c.amount)}</span><StatusBadge status={c.display_status} /></span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-muted-foreground">QR Code Pix e Pix Copia e Cola ficarão disponíveis quando a cobrança Pix do GEAB for configurada. Por enquanto, siga as instruções de pagamento do grupo.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Pagamentos realizados</CardTitle></CardHeader>
              <CardContent>
                {data.payments.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p> : (
                  <ul className="divide-y text-sm">{data.payments.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{formatDate(p.paid_at)}</span><span className="font-medium tabular-nums">{formatBRL(p.amount)}</span></li>)}</ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Meus contatos</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="p">Telefone (WhatsApp)</Label><Input id="p" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label htmlFor="e">E-mail</Label><Input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar contatos</Button></div>
                </form>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  )
}
