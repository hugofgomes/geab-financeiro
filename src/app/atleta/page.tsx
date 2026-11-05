"use client"

import { NameCard, PasswordCard } from "@/components/account-cards"
import { BirthdayCard } from "@/components/birthday-card"
import { SidePanel } from "@/components/side-panel"
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
import type { Athlete, Charge, Payment, PixCharge } from "@/lib/types"
import { normalizePhone } from "@/lib/whatsapp"
import { brCodeForAmount } from "@/lib/brcode"
import { Copy, ExternalLink, Loader2, LogOut } from "lucide-react"
import QRCode from "qrcode"
import * as React from "react"
import { toast } from "sonner"

export default function AthletePortal() {
  const { data, error, loading, reload } = useLoad(async () => {
    const sb = supabase()
    const [a, c, p, x, st] = await Promise.all([
      sb.from("athletes").select("*").single(),   // RLS: só o próprio cadastro
      sb.from("charges_view").select("*").order("competence", { ascending: false }),
      sb.from("payments").select("*").order("paid_at", { ascending: false }),
      sb.from("pix_charges").select("*").eq("status", "ativa").order("created_at", { ascending: false }),
      sb.from("app_settings").select("value").eq("key", "pix_br_code").maybeSingle(),
    ])
    for (const r of [a, c, p, x]) if (r.error) throw new Error(r.error.message)
    const pix = new Map<string, PixCharge>()
    for (const q of x.data as PixCharge[]) if (!pix.has(q.charge_id) && (!q.expires_at || new Date(q.expires_at) > new Date())) pix.set(q.charge_id, q)
    return { athlete: a.data as Athlete, charges: c.data as Charge[], payments: p.data as Payment[], pix, staticCode: (st.data?.value as string | undefined) ?? null }
  }, [])
  const [phone, setPhone] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [showCard, setShowCard] = React.useState(false)
  // Pix estático da Diretoria: um código (e QR) com o valor exato de cada mensalidade em aberto
  const [staticPix, setStaticPix] = React.useState<{ id: string; competence: string; cents: number; code: string; qr: string }[]>([])
  React.useEffect(() => {
    if (!data?.staticCode) { setStaticPix([]); return }
    let alive = true
    const open = data.charges.filter((c) => c.balance > 0 && !data.pix.has(c.id))
    Promise.all(open.map(async (c) => {
      const cents = Math.round(c.balance * 100)
      const code = brCodeForAmount(data.staticCode!, cents, "GEAB" + c.id.replace(/-/g, "").slice(0, 12))
      return code ? { id: c.id, competence: c.competence, cents, code, qr: await QRCode.toDataURL(code, { margin: 1, width: 240 }) } : null
    })).then((r) => alive && setStaticPix(r.filter((x): x is NonNullable<typeof x> => !!x)))
    return () => { alive = false }
  }, [data])
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
      <header className="border-b bg-[#1C3D63] text-white shadow-sm">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4"><span className="font-bold tracking-wide uppercase">GEAB Futebol</span>
          <Button variant="ghost" size="sm" onClick={signOut} className="text-white/80 hover:bg-white/10 hover:text-white"><LogOut /> Sair</Button></div>
      </header>
      {data && (
        <BirthdayCard
          names={showCard ? [data.athlete.nickname || data.athlete.full_name.split(" ")[0]] : []}
          self
          onClose={() => { markSeen(`atleta.${data.athlete.id}`); setShowCard(false) }}
        />
      )}
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 xl:flex-row">
      <main className="min-w-0 flex-1 space-y-5">
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
                {data.charges.some((c) => c.balance > 0 && data.pix.has(c.id)) ? (
                  <div className="mt-4 space-y-3">
                    <h3 className="text-sm font-semibold text-primary">Pagar com Pix</h3>
                    {data.charges.filter((c) => c.balance > 0 && data.pix.has(c.id)).map((c) => {
                      const q = data.pix.get(c.id)!
                      return (
                        <div key={c.id} className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-3">
                          {q.qr_image && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={q.qr_image} alt={`QR Code Pix da mensalidade de ${formatCompetence(c.competence)}`} width={120} height={120} className="size-[120px] rounded-lg border bg-white p-1" />
                          )}
                          <div className="min-w-0 space-y-2 text-sm">
                            <p><span className="font-medium capitalize">{formatCompetence(c.competence)}</span> · {formatBRL(q.value_cents / 100)}</p>
                            <div className="flex flex-wrap gap-2">
                              {q.br_code && <Button type="button" size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(q.br_code!).then(() => toast.success("Pix Copia e Cola copiado."), () => toast.error("Não foi possível copiar."))}><Copy /> Copiar código Pix</Button>}
                              {q.payment_link && <a href={q.payment_link} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[0.8rem] hover:bg-secondary"><ExternalLink className="size-3.5" /> Abrir link</a>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    <p className="text-xs text-muted-foreground">Depois de pagar, a confirmação é automática: sua mensalidade passa para “Pago” em instantes.</p>
                  </div>
                ) : staticPix.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <h3 className="text-sm font-semibold text-primary">Pagar com Pix</h3>
                    {staticPix.map((q) => (
                      <div key={q.id} className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={q.qr} alt={`QR Code Pix da mensalidade de ${formatCompetence(q.competence)}`} width={140} height={140} className="size-[140px] rounded-lg border bg-white p-1" />
                        <div className="min-w-0 space-y-2 text-sm">
                          <p><span className="font-medium capitalize">{formatCompetence(q.competence)}</span> · {formatBRL(q.cents / 100)}</p>
                          <Button type="button" size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(q.code).then(() => toast.success("Pix Copia e Cola copiado."), () => toast.error("Não foi possível copiar."))}><Copy /> Copiar código Pix</Button>
                        </div>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">Pague pelo app do seu banco. Seu pagamento é conferido pela Diretoria e a mensalidade passa para “Pago” depois da conferência (não é instantâneo).</p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">Quando o GEAB gerar o Pix da sua mensalidade, o QR Code e o Pix Copia e Cola aparecerão aqui. Enquanto isso, siga as instruções de pagamento do grupo.</p>
                )}
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
              <CardHeader><CardTitle className="text-base">Meu cadastro</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {([
                    ["Nome", data.athlete.full_name],
                    ["Apelido", data.athlete.nickname || "—"],
                    ["Nascimento", data.athlete.birth_date ? formatDate(data.athlete.birth_date) : "—"],
                    ["E-mail", data.athlete.email || "—"],
                    ["WhatsApp", data.athlete.phone ? `+${data.athlete.phone}` : "—"],
                    ["Mensalidade", `${formatBRL(data.athlete.monthly_fee)} · vence dia ${data.athlete.due_day}`],
                    ["Situação", data.athlete.active ? "Ativo" : "Inativo"],
                    ["No GEAB desde", formatDate(data.athlete.joined_at)],
                  ] as const).map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b py-1.5 sm:block sm:border-0"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}
                </dl>
              </CardContent>
            </Card>
            <NameCard fullName={data.athlete.full_name} nickname={data.athlete.nickname} withNickname onSaved={reload} />
            <PasswordCard />
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
      <SidePanel />
      </div>
    </div>
  )
}
