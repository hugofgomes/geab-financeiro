"use client"
/* eslint-disable @next/next/no-img-element -- logotipos e fotos vêm do armazenamento do próprio centro */

import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { sportLabel } from "@/hooks/use-court-role"
import { addDays, fmtDateBR, fmtMinutes, fmtRange, localParts, todayIn, WEEKDAYS_SHORT, zonedToUtc } from "@/lib/court-time"
import { addressLine, FLOOR_LABEL, waNumber, type PubMatch, type PubSlot, type PubVenue } from "@/lib/court-public"
import { formatBRL } from "@/lib/format"
import { supabase } from "@/lib/supabase/client"
import { maskPhone } from "@/lib/whatsapp"
import { cn } from "@/lib/utils"
import { Loader2, MapPin, MessageCircle, Phone } from "lucide-react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import * as React from "react"

type Done = { code: string; status: string; price_cents: number; manage_token: string | null; waText: string }

/** Página pública do centro esportivo: quadras, preços, horários livres, solicitação de reserva e partidas com vagas. */
export default function CentroPublico() {
  const { slug } = useParams<{ slug: string }>()
  const sp = useSearchParams()
  const [data, setData] = React.useState<PubVenue | null | undefined>(undefined)
  const [matches, setMatches] = React.useState<PubMatch[]>([])
  const [date, setDate] = React.useState("")
  const [minutes, setMinutes] = React.useState(0)
  const [slots, setSlots] = React.useState<PubSlot[] | null>(null)
  const [pick, setPick] = React.useState<{ slot: PubSlot; court: string } | null>(null)
  const [joinM, setJoinM] = React.useState<PubMatch | null>(null)
  const [done, setDone] = React.useState<Done | null>(null)
  const loadVenue = React.useCallback(async () => {
    const [v, m] = await Promise.all([supabase().rpc("court_public_venue", { p_slug: slug }), supabase().rpc("court_public_matches", { p_slug: slug })])
    const pv = (v.data ?? null) as PubVenue | null
    setData(pv); setMatches((m.data ?? []) as PubMatch[])
    if (pv) { document.title = `${pv.venue.name} · Partidou`; setMinutes((x) => x || pv.venue.min_duration_minutes) }
  }, [slug])
  React.useEffect(() => { void loadVenue() }, [loadVenue])
  const tz = data?.venue.timezone ?? "America/Sao_Paulo"
  const today = todayIn(tz)
  React.useEffect(() => { if (data && !date) { const q = sp.get("data"); setDate(q && /^\d{4}-\d{2}-\d{2}$/.test(q) && q >= today ? q : today) } }, [data, date, sp, today])
  const loadSlots = React.useCallback(async () => {
    if (!data || !date || !minutes) return
    setSlots(null)
    const r = await supabase().rpc("court_public_availability", { p_slug: slug, p_date: date, p_minutes: minutes })
    setSlots(((r.data ?? []) as PubSlot[]))
  }, [data, date, minutes, slug])
  React.useEffect(() => { void loadSlots() }, [loadSlots])

  if (data === undefined) return <div className="quadra-theme min-h-dvh bg-background p-6"><Skeleton className="mx-auto h-60 max-w-3xl" /></div>
  if (data === null) return <div className="quadra-theme grid min-h-dvh place-items-center bg-background p-6 text-center"><div><h1 className="text-xl font-bold">Centro esportivo não encontrado</h1><p className="mt-1 text-sm text-muted-foreground">O endereço pode estar errado ou o centro não publicou a página.</p><Link href="/quadras" className="mt-3 inline-block font-medium text-primary underline">Buscar outras quadras</Link></div></div>
  const { venue, courts } = data
  const durations: number[] = []; for (let m = venue.min_duration_minutes; m <= 240 && durations.length < 4; m += venue.slot_minutes) durations.push(m)
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i)).filter((d) => d <= addDays(today, venue.max_advance_days))
  const wa = waNumber(venue.whatsapp)
  const priceRange = (cid: string) => { const c = courts.find((x) => x.id === cid)!; const rules = data.prices.filter((r) => r.court_id === null || r.court_id === cid).map((r) => r.price_cents); const all = [c.price_cents, ...rules]; const lo = Math.min(...all), hi = Math.max(...all); return lo === hi ? formatBRL(lo / 100) : `${formatBRL(lo / 100)} a ${formatBRL(hi / 100)}` }
  const hoursOf = (cid: string) => { const own = data.hours.filter((h) => h.court_id === cid); return own.length ? own : data.hours.filter((h) => h.court_id === null) }
  const hoursText = (cid: string) => { const hs = hoursOf(cid); if (!hs.length) return "Horários em breve"; const byDay = new Map<number, string[]>(); for (const h of hs) byDay.set(h.weekday, [...(byDay.get(h.weekday) ?? []), `${fmtMinutes(h.opens_min)}–${fmtMinutes(h.closes_min)}`]); return [...byDay].sort((a, b) => a[0] - b[0]).map(([d, r]) => `${WEEKDAYS_SHORT[d]} ${r.join(", ")}`).join(" · ") }

  return (
    <div className="quadra-theme min-h-dvh bg-background text-foreground">
      <header className="bg-primary px-4 py-6 text-primary-foreground">
        <div className="mx-auto flex max-w-4xl items-center gap-4">
          {venue.logo_url ? <img src={venue.logo_url} alt="" className="size-16 shrink-0 rounded-xl bg-white object-cover" /> : null}
          <div className="min-w-0"><Link href="/quadras" className="text-xs font-semibold tracking-wide opacity-80">PARTIDOU</Link><h1 className="text-2xl font-bold leading-tight">{venue.name}</h1>
            <p className="flex items-center gap-1 text-sm opacity-90"><MapPin className="size-4 shrink-0" />{addressLine(venue)}</p></div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        {venue.description && <p className="whitespace-pre-line text-sm">{venue.description}</p>}
        <div className="flex flex-wrap gap-2 text-sm">
          {wa && <a className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 font-medium text-primary-foreground" target="_blank" rel="noreferrer" href={`https://wa.me/${wa}?text=${encodeURIComponent(`Olá! Vi a ${venue.name} no Partidou.`)}`}><MessageCircle className="size-4" /> WhatsApp</a>}
          {venue.phone && <a className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 font-medium" href={`tel:${venue.phone}`}><Phone className="size-4" /> Ligar</a>}
          {venue.latitude != null && venue.longitude != null ? <a className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 font-medium" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${venue.latitude},${venue.longitude}`}><MapPin className="size-4" /> Mapa</a>
            : <a className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 font-medium" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/${encodeURIComponent(addressLine(venue))}`}><MapPin className="size-4" /> Mapa</a>}
          {venue.instagram && <a className="inline-flex min-h-10 items-center rounded-lg border px-3 font-medium" target="_blank" rel="noreferrer" href={`https://instagram.com/${venue.instagram.replace(/^@/, "")}`}>Instagram</a>}
        </div>

        <section aria-labelledby="h-q" className="space-y-3"><h2 id="h-q" className="text-lg font-semibold">Quadras</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {courts.map((c) => (
              <li key={c.id} className="overflow-hidden rounded-2xl border bg-card">
                {c.photos[0] && <img src={c.photos[0]} alt={`Foto da ${c.name}`} className="h-40 w-full object-cover" loading="lazy" />}
                <div className="space-y-1 p-3"><p className="font-semibold">{c.name}</p>
                  <p className="text-sm text-muted-foreground">{sportLabel(c.sport)}{c.floor_type && ` · ${FLOOR_LABEL[c.floor_type] ?? c.floor_type}`}{c.covered && " · coberta"}{c.lighting && " · iluminada"}{c.capacity && ` · ${c.capacity} pessoas`}</p>
                  {c.description && <p className="text-sm">{c.description}</p>}
                  <p className="text-sm font-medium">{priceRange(c.id)} por hora</p><p className="text-xs text-muted-foreground">{hoursText(c.id)}</p></div>
              </li>
            ))}
          </ul></section>

        <section aria-labelledby="h-d" className="space-y-3"><h2 id="h-d" className="text-lg font-semibold">Horários livres</h2>
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Escolha o dia">
            {days.map((d) => <button key={d} type="button" role="tab" aria-selected={d === date} onClick={() => setDate(d)} className={cn("min-h-12 min-w-16 shrink-0 rounded-xl border px-3 text-center text-sm", d === date ? "border-primary bg-primary text-primary-foreground" : "bg-card")}><span className="block text-xs">{WEEKDAYS_SHORT[new Date(d + "T12:00").getDay()]}</span><span className="block font-semibold">{d.slice(8)}/{d.slice(5, 7)}</span></button>)}
          </div>
          <div className="flex items-center gap-2 text-sm"><Label htmlFor="dur">Duração</Label><NativeSelect id="dur" className="w-40" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>{durations.map((m) => <option key={m} value={m}>{m / 60 === 1 ? "1 hora" : `${m / 60} horas`}</option>)}</NativeSelect></div>
          {slots === null ? <Skeleton className="h-24" /> : slots.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhum horário livre neste dia. Escolha outro dia ou fale com o centro.</p> : (
            <div className="space-y-3">{courts.map((c) => { const mine = slots.filter((s) => s.court_id === c.id); if (!mine.length) return null
              return <div key={c.id}><p className="mb-1 text-sm font-medium">{c.name}</p><div className="flex flex-wrap gap-2">{mine.map((s) => <button key={s.start_min} type="button" onClick={() => setPick({ slot: s, court: c.name })} className="min-h-11 rounded-lg border bg-card px-3 text-sm hover:border-primary"><span className="block font-semibold">{fmtMinutes(s.start_min)}</span><span className="block text-xs text-muted-foreground">{formatBRL(s.price_cents / 100)}</span></button>)}</div></div> })}</div>
          )}
          <p className="text-xs text-muted-foreground">{venue.auto_confirm ? "A reserva é confirmada na hora." : "Sua solicitação fica pendente até o centro confirmar."} Cancelamento gratuito até {venue.cancel_free_hours} h antes{venue.cancel_fee_pct > 0 ? `; depois, cobrança de ${venue.cancel_fee_pct}%` : ""}.</p></section>

        {matches.length > 0 && <section aria-labelledby="h-m" className="space-y-3"><h2 id="h-m" className="text-lg font-semibold">Partidas com vagas</h2>
          <ul className="space-y-2">{matches.map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3"><div className="min-w-0"><p className="font-semibold">{m.title}</p><p className="text-sm text-muted-foreground">{m.court}{m.sport && ` · ${sportLabel(m.sport)}`} · {fmtDateBR(localParts(tz, m.starts_at).date)} {fmtRange(tz, m.starts_at, m.ends_at)}</p><p className="text-xs">{m.slots_total - m.approved} de {m.slots_total} vaga(s)</p></div><Button onClick={() => setJoinM(m)}>Pedir vaga</Button></li>)}</ul></section>}
      </main>
      <footer className="px-4 pb-8 text-center text-xs text-muted-foreground">Partidou · o jogo começa aqui</footer>

      <RequestDialog slug={slug} pick={pick} date={date} tz={tz} venueName={venue.name} onClose={() => setPick(null)} onDone={(d) => { setPick(null); setDone(d); void loadSlots(); void loadVenue() }} />
      <JoinDialog match={joinM} tz={tz} onClose={() => setJoinM(null)} onDone={() => { setJoinM(null); void loadVenue() }} />
      <Dialog open={!!done} onOpenChange={(o) => !o && setDone(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{done?.status === "confirmada" ? "Reserva confirmada!" : "Solicitação enviada!"}</DialogTitle><DialogDescription>Código {done?.code} · {done && formatBRL(done.price_cents / 100)}. {done?.status === "pendente" ? "O centro vai confirmar o seu horário; fale pelo WhatsApp se precisar de urgência." : "Até lá!"}</DialogDescription></DialogHeader>
          {done?.manage_token && <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Guarde o link da sua partida</p><p>É com ele que você aprova os jogadores. Ele aparece só agora.</p>
            <p className="break-all text-xs">{`${typeof window === "undefined" ? "" : window.location.origin}/partida/${done.manage_token}`}</p>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/partida/${done.manage_token}`) }}>Copiar link</Button></div></div>}
          <DialogFooter className="gap-2">
            <a className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(done?.waText ?? "")}`}><MessageCircle className="size-4" /> Compartilhar no WhatsApp</a>
            <Button onClick={() => setDone(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RequestDialog({ slug, pick, date, tz, venueName, onClose, onDone }: { slug: string; pick: { slot: PubSlot; court: string } | null; date: string; tz: string; venueName: string; onClose: () => void; onDone: (d: Done) => void }) {
  const [v, setV] = React.useState({ name: "", phone: "", notes: "", match: false, slots: "4", title: "", website: "" })
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState("")
  if (!pick) return null
  const { slot } = pick
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("")
    if (v.website) return   // campo-isca: robôs preenchem, pessoas não veem
    setBusy(true)
    const start = zonedToUtc(tz, date, slot.start_min), end = zonedToUtc(tz, date, slot.end_min)
    const r = await supabase().rpc("court_public_request", { p_slug: slug, p_court: slot.court_id, p_start: start.toISOString(), p_end: end.toISOString(), p_name: v.name, p_phone: v.phone, p_sport: null, p_notes: v.notes || null, p_match_slots: v.match ? Number(v.slots) : null, p_match_title: v.match ? v.title || null : null })
    setBusy(false)
    if (r.error) return setErr(r.error.message)
    const d = r.data as { code: string; status: string; price_cents: number; manage_token: string | null }
    onDone({ ...d, waText: `Reservei na ${venueName}: ${pick!.court}, ${fmtDateBR(date)} às ${fmtMinutes(slot.start_min)}.${v.match ? ` Faltam ${v.slots} jogador(es)! Peça sua vaga: ${window.location.href.split("?")[0]}` : ""}` })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle>Solicitar reserva</DialogTitle><DialogDescription>{pick.court} · {fmtDateBR(date)} · {fmtMinutes(slot.start_min)} às {fmtMinutes(slot.end_min)} · {formatBRL(slot.price_cents / 100)}</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="rn">Seu nome</Label><Input id="rn" required minLength={2} maxLength={120} autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="rp">WhatsApp / telefone</Label><Input id="rp" required inputMode="tel" autoComplete="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: maskPhone(e.target.value) })} placeholder="(48) 99999-0000" /></div>
          <div className="space-y-1.5"><Label htmlFor="ro">Observações</Label><Input id="ro" maxLength={200} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
          <div aria-hidden className="absolute -left-[9999px]"><label>Site<input tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} /></label></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.match} onChange={(e) => setV({ ...v, match: e.target.checked })} /><span>Quero publicar vagas para completar o time (partida)</span></label>
          {v.match && <div className="grid grid-cols-3 gap-2"><div className="col-span-2 space-y-1.5"><Label htmlFor="rt">Nome da partida</Label><Input id="rt" maxLength={80} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Racha de quinta" /></div><div className="space-y-1.5"><Label htmlFor="rs">Vagas</Label><Input id="rs" type="number" min={1} max={40} required value={v.slots} onChange={(e) => setV({ ...v, slots: e.target.value })} /></div></div>}
          <p className="text-xs text-muted-foreground">Usamos seu telefone só para o centro falar com você sobre esta reserva.</p>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Voltar</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Enviar solicitação</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function JoinDialog({ match, tz, onClose, onDone }: { match: PubMatch | null; tz: string; onClose: () => void; onDone: () => void }) {
  const [v, setV] = React.useState({ name: "", phone: "" })
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null)
  if (!match) return null
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null)
    const r = await supabase().rpc("court_public_match_join", { p_match: match!.id, p_name: v.name, p_phone: v.phone })
    setBusy(false)
    if (r.error) return setMsg({ ok: false, t: r.error.message })
    setMsg({ ok: true, t: "Pedido enviado! O organizador vai aprovar e falar com você pelo telefone informado." })
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setMsg(null); (msg?.ok ? onDone : onClose)() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Pedir vaga · {match.title}</DialogTitle><DialogDescription>{match.court} · {fmtDateBR(localParts(tz, match.starts_at).date)} {fmtRange(tz, match.starts_at, match.ends_at)}</DialogDescription></DialogHeader>
        {msg?.ok ? <p role="status" className="text-sm">{msg.t}</p> : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="jn">Seu nome</Label><Input id="jn" required minLength={2} maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="jp">WhatsApp / telefone</Label><Input id="jp" required inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: maskPhone(e.target.value) })} /></div>
            <p className="text-xs text-muted-foreground">Seu telefone é mostrado só ao organizador da partida.</p>
            {msg && <p role="alert" className="text-sm text-destructive">{msg.t}</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Voltar</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Pedir vaga</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
