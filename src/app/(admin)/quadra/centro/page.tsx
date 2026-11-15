"use client"

import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FLOORS, SPORTS, sportLabel, useCourtRoleCtx } from "@/hooks/use-court-role"
import { useLoad } from "@/hooks/use-load"
import { useOrg } from "@/hooks/use-org"
import { formatBRL } from "@/lib/format"
import { prepareImage } from "@/lib/image"
import { supabase } from "@/lib/supabase/client"
import { maskPhone, normalizePhone } from "@/lib/whatsapp"
import { ImagePlus, Loader2, MapPin, Plus, X } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Venue = {
  id: string; trade_name: string; legal_name: string | null; doc_type: "cpf" | "cnpj" | null; document: string | null; description: string | null; logo_url: string | null
  phone: string | null; whatsapp: string | null; email: string | null; website: string | null; instagram: string | null; facebook: string | null
  cep: string | null; street: string | null; number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null
  latitude: number | null; longitude: number | null; timezone: string; public_enabled?: boolean; public_auto_confirm?: boolean
}
type Court = { id: string; name: string; description: string | null; sport: string; floor_type: string | null; covered: boolean; lighting: boolean; capacity: number | null; photos: string[]; price_cents: number; active: boolean }

const UF = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]
const digits = (s: string) => s.replace(/\D/g, "")
const phoneShow = (v: string | null) => (v ? maskPhone(v.replace(/^55/, "")) : "")
const maskDoc = (t: string, v: string) => { const d = digits(v).slice(0, t === "cnpj" ? 14 : 11); return t === "cnpj" ? d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2") : d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4") }

async function load() {
  const sb = supabase()
  const [v, c] = await Promise.all([sb.from("court_venues").select("*").maybeSingle(), sb.from("court_courts").select("*").order("sort_order").order("name")])
  if (v.error) throw new Error(v.error.message)
  if (c.error) throw new Error(c.error.message)
  return { venue: v.data as Venue | null, courts: (c.data ?? []) as Court[] }
}

/** Envia uma imagem ao armazenamento do módulo, na pasta do próprio estabelecimento. */
async function uploadImage(tenantId: string, file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error("Use uma imagem PNG, JPG ou WebP.")
  if (file.size > 12_000_000) throw new Error("Imagem muito grande (máximo 12 MB).")
  const blob = await prepareImage(file)
  const path = `${tenantId}/${crypto.randomUUID()}.jpg`
  const up = await supabase().storage.from("quadras").upload(path, blob, { contentType: "image/jpeg", upsert: false })
  if (up.error) throw new Error(up.error.message)
  return supabase().storage.from("quadras").getPublicUrl(path).data.publicUrl
}
const removeImage = (url: string) => { const p = url.split("/object/public/quadras/")[1]; if (p) void supabase().storage.from("quadras").remove([p]) }

export default function CentroPage() {
  const role = useCourtRoleCtx()
  const org = useOrg()
  const { data, error, loading, reload } = useLoad(load, [])
  if (error) return <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>
  if (loading && !data) return <Skeleton className="h-60" />
  if (!data || !org) return <Skeleton className="h-60" />
  const canVenue = role === "admin"
  const canCourts = role === "admin" || role === "gerente"
  return (
    <>
      <div><h1 className="text-2xl font-bold tracking-tight">Centro Esportivo</h1>
        <p className="text-sm text-muted-foreground">Cadastro do estabelecimento e das quadras.{!canVenue && " Você tem acesso de consulta ao perfil do centro."}</p></div>
      <Tabs defaultValue={data.venue ? "quadras" : "perfil"}>
        <TabsList className="h-12 w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="perfil" className="h-10 shrink-0 px-4">Perfil</TabsTrigger>
          <TabsTrigger value="endereco" className="h-10 shrink-0 px-4">Endereço</TabsTrigger>
          <TabsTrigger value="quadras" className="h-10 shrink-0 px-4">Quadras ({data.courts.length})</TabsTrigger>
          <TabsTrigger value="publica" className="h-10 shrink-0 px-4">Página pública</TabsTrigger>
        </TabsList>
        <TabsContent value="perfil"><VenueForm key={data.venue?.id ?? "novo"} venue={data.venue} tenantId={org.id} canEdit={canVenue} section="perfil" onSaved={reload} /></TabsContent>
        <TabsContent value="endereco"><VenueForm key={(data.venue?.id ?? "novo") + "e"} venue={data.venue} tenantId={org.id} canEdit={canVenue} section="endereco" onSaved={reload} /></TabsContent>
        <TabsContent value="publica"><PublicPage venue={data.venue} slug={(org as { slug?: string }).slug ?? ""} canEdit={canVenue} hasCourts={data.courts.some((c) => c.active)} onSaved={reload} /></TabsContent>
        <TabsContent value="quadras"><Courts venue={data.venue} courts={data.courts} tenantId={org.id} canEdit={canCourts} onChanged={reload} /></TabsContent>
      </Tabs>
    </>
  )
}

function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
}

function VenueForm({ venue, tenantId, canEdit, section, onSaved }: { venue: Venue | null; tenantId: string; canEdit: boolean; section: "perfil" | "endereco"; onSaved: () => void }) {
  const v = venue
  const [f, setF] = React.useState({
    trade_name: v?.trade_name ?? "", legal_name: v?.legal_name ?? "", doc_type: (v?.doc_type ?? "cnpj") as "cpf" | "cnpj", document: v?.document ? maskDoc(v.doc_type ?? "cnpj", v.document) : "",
    description: v?.description ?? "", phone: phoneShow(v?.phone ?? null), whatsapp: phoneShow(v?.whatsapp ?? null), email: v?.email ?? "", website: v?.website ?? "", instagram: v?.instagram ?? "", facebook: v?.facebook ?? "",
    cep: v?.cep ? v.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2") : "", street: v?.street ?? "", number: v?.number ?? "", complement: v?.complement ?? "", district: v?.district ?? "", city: v?.city ?? "", state: v?.state ?? "",
    latitude: v?.latitude != null ? String(v.latitude) : "", longitude: v?.longitude != null ? String(v.longitude) : "",
  })
  const [logo, setLogo] = React.useState<string | null>(v?.logo_url ?? null)
  const [busy, setBusy] = React.useState(false)
  const [upl, setUpl] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }))
  const ro = !canEdit

  async function cepLookup() {
    const d = digits(f.cep)
    if (d.length !== 8 || f.street) return
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`)
      const j = (await r.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }
      if (!j.erro) setF((x) => ({ ...x, street: j.logradouro ?? x.street, district: j.bairro ?? x.district, city: j.localidade ?? x.city, state: j.uf ?? x.state }))
    } catch { /* sem internet ou serviço fora do ar: o preenchimento manual continua */ }
  }
  async function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ""
    if (!file) return
    setUpl(true)
    try { setLogo(await uploadImage(tenantId, file)) } catch (err) { toast.error(err instanceof Error ? err.message : "Não foi possível enviar a imagem.") }
    setUpl(false)
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")))
    const lat = num(f.latitude), lng = num(f.longitude)
    if ((lat != null && !Number.isFinite(lat)) || (lng != null && !Number.isFinite(lng))) return toast.error("Latitude e longitude inválidas.")
    const tel = (s: string) => { const n = s.trim() ? normalizePhone(s) : null; return n }
    const payload = {
      trade_name: f.trade_name.trim(), legal_name: f.legal_name.trim() || null, doc_type: digits(f.document) ? f.doc_type : null, document: digits(f.document) || null,
      description: f.description.trim() || null, logo_url: logo, phone: tel(f.phone), whatsapp: tel(f.whatsapp), email: f.email.trim() || null, website: f.website.trim() || null,
      instagram: f.instagram.trim() || null, facebook: f.facebook.trim() || null, cep: digits(f.cep) || null, street: f.street.trim() || null, number: f.number.trim() || null,
      complement: f.complement.trim() || null, district: f.district.trim() || null, city: f.city.trim() || null, state: f.state || null, latitude: lat, longitude: lng,
    }
    setBusy(true)
    const sb = supabase()
    const r = v ? await sb.from("court_venues").update(payload).eq("id", v.id) : await sb.from("court_venues").insert(payload)
    setBusy(false)
    if (r.error) return toast.error(/row-level security/i.test(r.error.message) ? "Você não tem permissão para alterar o centro." : r.error.message)
    toast.success("Centro esportivo salvo."); onSaved()
  }
  const map = f.latitude && f.longitude ? `https://www.google.com/maps?q=${encodeURIComponent(`${f.latitude},${f.longitude}`)}` : (f.street || f.city) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([f.street, f.number, f.district, f.city, f.state].filter(Boolean).join(", "))}` : null

  return (
    <Card><CardContent className="pt-4">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <fieldset disabled={ro || busy} className="contents">
          {section === "perfil" && <>
            <div className="sm:col-span-2 space-y-2">
              <Label>Logotipo</Label>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pickLogo} aria-label="Escolher logotipo" />
              <div className="flex items-center gap-3">
                {logo ? <LogoImg src={logo} /> : <span aria-hidden className="grid size-20 place-items-center rounded-xl border border-dashed text-muted-foreground"><ImagePlus className="size-6" /></span>}
                {!ro && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="h-11 sm:h-9" disabled={upl} onClick={() => fileRef.current?.click()}>{upl && <Loader2 className="animate-spin" />}{logo ? "Trocar" : "Enviar logotipo"}</Button>
                  {logo && <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => { removeImage(logo); setLogo(null) }}>Remover</Button>}</div>}
              </div>
            </div>
            <Field id="v-n" label="Nome fantasia"><Input id="v-n" required minLength={2} maxLength={100} className="h-11 sm:h-9" value={f.trade_name} onChange={set("trade_name")} /></Field>
            <Field id="v-l" label="Razão social (se houver)"><Input id="v-l" maxLength={150} className="h-11 sm:h-9" value={f.legal_name} onChange={set("legal_name")} /></Field>
            <Field id="v-t" label="Tipo de documento"><NativeSelect id="v-t" className="h-11 w-full sm:h-9" value={f.doc_type} onChange={(e) => setF((x) => ({ ...x, doc_type: e.target.value as "cpf" | "cnpj", document: maskDoc(e.target.value, x.document) }))}><option value="cnpj">CNPJ</option><option value="cpf">CPF</option></NativeSelect></Field>
            <Field id="v-d" label={f.doc_type === "cnpj" ? "CNPJ" : "CPF"} hint="Validado no cadastro."><Input id="v-d" inputMode="numeric" className="h-11 sm:h-9" value={f.document} onChange={(e) => setF((x) => ({ ...x, document: maskDoc(x.doc_type, e.target.value) }))} /></Field>
            <div className="sm:col-span-2"><Field id="v-ds" label="Descrição"><textarea id="v-ds" rows={3} maxLength={1000} value={f.description} onChange={set("description")} className="w-full rounded-lg border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:text-sm" /></Field></div>
            <Field id="v-p" label="Telefone"><Input id="v-p" type="tel" inputMode="tel" className="h-11 sm:h-9" value={f.phone} onChange={(e) => setF((x) => ({ ...x, phone: maskPhone(e.target.value) }))} /></Field>
            <Field id="v-w" label="WhatsApp"><Input id="v-w" type="tel" inputMode="tel" className="h-11 sm:h-9" value={f.whatsapp} onChange={(e) => setF((x) => ({ ...x, whatsapp: maskPhone(e.target.value) }))} /></Field>
            <Field id="v-e" label="E-mail"><Input id="v-e" type="email" maxLength={160} className="h-11 sm:h-9" value={f.email} onChange={set("email")} /></Field>
            <Field id="v-s" label="Site"><Input id="v-s" maxLength={160} className="h-11 sm:h-9" value={f.website} onChange={set("website")} /></Field>
            <Field id="v-i" label="Instagram"><Input id="v-i" maxLength={100} placeholder="@seucentro" className="h-11 sm:h-9" value={f.instagram} onChange={set("instagram")} /></Field>
            <Field id="v-f" label="Facebook"><Input id="v-f" maxLength={160} className="h-11 sm:h-9" value={f.facebook} onChange={set("facebook")} /></Field>
          </>}
          {section === "endereco" && <>
            {!v && <p className="sm:col-span-2 rounded-lg bg-secondary p-3 text-sm">Salve primeiro o perfil do centro (aba Perfil) para cadastrar o endereço.</p>}
            <Field id="a-c" label="CEP" hint="Preenche rua, bairro e cidade automaticamente."><Input id="a-c" inputMode="numeric" maxLength={9} className="h-11 sm:h-9" value={f.cep} onBlur={cepLookup} onChange={(e) => setF((x) => ({ ...x, cep: digits(e.target.value).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2") }))} /></Field>
            <Field id="a-r" label="Rua"><Input id="a-r" maxLength={150} className="h-11 sm:h-9" value={f.street} onChange={set("street")} /></Field>
            <Field id="a-n" label="Número"><Input id="a-n" maxLength={20} className="h-11 sm:h-9" value={f.number} onChange={set("number")} /></Field>
            <Field id="a-m" label="Complemento"><Input id="a-m" maxLength={80} className="h-11 sm:h-9" value={f.complement} onChange={set("complement")} /></Field>
            <Field id="a-b" label="Bairro"><Input id="a-b" maxLength={80} className="h-11 sm:h-9" value={f.district} onChange={set("district")} /></Field>
            <Field id="a-ci" label="Cidade"><Input id="a-ci" maxLength={80} className="h-11 sm:h-9" value={f.city} onChange={set("city")} /></Field>
            <Field id="a-e" label="Estado"><NativeSelect id="a-e" className="h-11 w-full sm:h-9" value={f.state} onChange={set("state")}><option value="">—</option>{UF.map((u) => <option key={u}>{u}</option>)}</NativeSelect></Field>
            <div className="hidden sm:block" />
            <Field id="a-la" label="Latitude" hint="Opcional. Ex.: -27.5954"><Input id="a-la" inputMode="decimal" className="h-11 sm:h-9" value={f.latitude} onChange={set("latitude")} /></Field>
            <Field id="a-lo" label="Longitude" hint="Opcional. Ex.: -48.5480"><Input id="a-lo" inputMode="decimal" className="h-11 sm:h-9" value={f.longitude} onChange={set("longitude")} /></Field>
            {map && <div className="sm:col-span-2"><a href={map} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline underline-offset-4"><MapPin className="size-4" /> Ver no mapa</a></div>}
          </>}
        </fieldset>
        {canEdit && <div className="sm:col-span-2"><Button type="submit" variant="default" className="h-11 w-full sm:h-9 sm:w-auto" disabled={busy || upl || (section === "endereco" && !v)}>{busy && <Loader2 className="animate-spin" />} Salvar</Button></div>}
      </form>
    </CardContent></Card>
  )
}

// eslint-disable-next-line @next/next/no-img-element
const LogoImg = ({ src }: { src: string }) => <img src={src} alt="Logotipo" className="size-20 rounded-xl border object-cover" />

const emptyCourt = { id: "", name: "", description: "", sport: "futebol_society", floor_type: "", covered: false, lighting: false, capacity: "", price: "0,00", photos: [] as string[], active: true }

function Courts({ venue, courts, tenantId, canEdit, onChanged }: { venue: Venue | null; courts: Court[]; tenantId: string; canEdit: boolean; onChanged: () => void }) {
  const [edit, setEdit] = React.useState<typeof emptyCourt | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [upl, setUpl] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const open = (c?: Court) => setEdit(c ? { id: c.id, name: c.name, description: c.description ?? "", sport: c.sport, floor_type: c.floor_type ?? "", covered: c.covered, lighting: c.lighting, capacity: c.capacity ? String(c.capacity) : "", price: (c.price_cents / 100).toFixed(2).replace(".", ","), photos: c.photos, active: c.active } : { ...emptyCourt })

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ""
    if (!file || !edit) return
    if (edit.photos.length >= 8) return toast.error("Máximo de 8 fotos por quadra.")
    setUpl(true)
    try { const url = await uploadImage(tenantId, file); setEdit((x) => (x ? { ...x, photos: [...x.photos, url] } : x)) } catch (err) { toast.error(err instanceof Error ? err.message : "Não foi possível enviar a foto.") }
    setUpl(false)
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!edit || !venue) return
    const cents = Math.round(Number(edit.price.replace(/\./g, "").replace(",", ".")) * 100)
    if (!Number.isFinite(cents) || cents < 0 || cents > 1_000_000) return toast.error("Valor por horário inválido.")
    const cap = edit.capacity.trim() ? Number(edit.capacity) : null
    if (cap != null && (!Number.isInteger(cap) || cap < 1 || cap > 200)) return toast.error("Capacidade: de 1 a 200.")
    const payload = { venue_id: venue.id, name: edit.name.trim(), description: edit.description.trim() || null, sport: edit.sport, floor_type: edit.floor_type || null, covered: edit.covered, lighting: edit.lighting, capacity: cap, photos: edit.photos, price_cents: cents, active: edit.active }
    setBusy(true)
    const sb = supabase()
    const r = edit.id ? await sb.from("court_courts").update(payload).eq("id", edit.id) : await sb.from("court_courts").insert(payload)
    setBusy(false)
    if (r.error) return toast.error(/court_courts_name_uniq|duplicate/i.test(r.error.message) ? "Já existe uma quadra com esse nome." : /row-level security/i.test(r.error.message) ? "Você não tem permissão para alterar quadras." : r.error.message)
    toast.success(edit.id ? "Quadra atualizada." : "Quadra cadastrada."); setEdit(null); onChanged()
  }
  async function toggle(c: Court) {
    const r = await supabase().from("court_courts").update({ active: !c.active }).eq("id", c.id)
    if (r.error) return toast.error(r.error.message)
    toast.success(c.active ? "Quadra inativada." : "Quadra ativada."); onChanged()
  }

  if (!venue) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Cadastre primeiro o perfil do centro (aba Perfil) para poder adicionar quadras.</p>
  return (
    <div className="space-y-3">
      {canEdit && <Button variant="default" className="h-11 w-full sm:h-9 sm:w-auto" onClick={() => open()}><Plus /> Nova quadra</Button>}
      {courts.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma quadra cadastrada ainda.</p>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {courts.map((c) => (
          <li key={c.id} className="overflow-hidden rounded-2xl border bg-card">
            {c.photos[0]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={c.photos[0]} alt={`Foto da ${c.name}`} loading="lazy" className="h-36 w-full object-cover" />
              : <div aria-hidden className="grid h-36 place-items-center bg-secondary text-muted-foreground"><ImagePlus className="size-7" /></div>}
            <div className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2"><h3 className="min-w-0 truncate font-semibold">{c.name}</h3>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${c.active ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-700"}`}>{c.active ? "Ativa" : "Inativa"}</span></div>
              <p className="text-sm text-muted-foreground">{sportLabel(c.sport)}{c.floor_type ? ` · ${FLOORS.find(([k]) => k === c.floor_type)?.[1]}` : ""}{c.capacity ? ` · ${c.capacity} pessoas` : ""}</p>
              <p className="text-xs text-muted-foreground">{c.covered ? "Coberta" : "Descoberta"} · {c.lighting ? "Com iluminação" : "Sem iluminação"}</p>
              <p className="text-sm font-medium">{formatBRL(c.price_cents / 100)} <span className="font-normal text-muted-foreground">por horário</span></p>
              {canEdit && <div className="flex gap-2 pt-1"><Button size="sm" variant="outline" className="h-10 flex-1 sm:h-8" onClick={() => open(c)}>Editar</Button><Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={() => toggle(c)}>{c.active ? "Inativar" : "Ativar"}</Button></div>}
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          {edit && <>
            <DialogHeader><DialogTitle>{edit.id ? "Editar quadra" : "Nova quadra"}</DialogTitle><DialogDescription>Dados que aparecem para a equipe e, depois, na página pública.</DialogDescription></DialogHeader>
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field id="c-n" label="Nome da quadra"><Input id="c-n" required minLength={2} maxLength={80} className="h-11 sm:h-9" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field></div>
              <Field id="c-s" label="Modalidade"><NativeSelect id="c-s" className="h-11 w-full sm:h-9" value={edit.sport} onChange={(e) => setEdit({ ...edit, sport: e.target.value })}>{SPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
              <Field id="c-f" label="Tipo de piso"><NativeSelect id="c-f" className="h-11 w-full sm:h-9" value={edit.floor_type} onChange={(e) => setEdit({ ...edit, floor_type: e.target.value })}><option value="">—</option>{FLOORS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
              <Field id="c-cp" label="Capacidade (pessoas)"><Input id="c-cp" inputMode="numeric" className="h-11 sm:h-9" value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: e.target.value })} /></Field>
              <Field id="c-v" label="Valor por horário (R$)"><Input id="c-v" inputMode="decimal" className="h-11 sm:h-9" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} /></Field>
              <div className="sm:col-span-2"><Field id="c-d" label="Descrição"><textarea id="c-d" rows={2} maxLength={500} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className="w-full rounded-lg border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm" /></Field></div>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={edit.covered} onChange={(e) => setEdit({ ...edit, covered: e.target.checked })} /> Coberta</label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={edit.lighting} onChange={(e) => setEdit({ ...edit, lighting: e.target.checked })} /> Com iluminação</label>
              <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-5" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Quadra ativa (disponível para reservas)</label>
              <div className="space-y-2 sm:col-span-2">
                <Label>Fotos ({edit.photos.length}/8)</Label>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pick} aria-label="Adicionar foto" />
                <div className="grid grid-cols-3 gap-2">
                  {edit.photos.map((u) => (
                    <div key={u} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" className="aspect-square w-full rounded-lg border object-cover" />
                      <button type="button" aria-label="Remover foto" onClick={() => { removeImage(u); setEdit({ ...edit, photos: edit.photos.filter((p) => p !== u) }) }} className="absolute top-1 right-1 grid size-8 place-items-center rounded-full bg-black/65 text-white"><X className="size-4" /></button>
                    </div>
                  ))}
                  {edit.photos.length < 8 && <button type="button" disabled={upl} onClick={() => fileRef.current?.click()} className="grid aspect-square place-items-center rounded-lg border border-dashed text-muted-foreground hover:bg-secondary">{upl ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" aria-label="Adicionar foto" />}</button>}
                </div>
              </div>
              <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setEdit(null)}>Cancelar</Button><Button type="submit" variant="default" disabled={busy || upl}>{busy && <Loader2 className="animate-spin" />} Salvar quadra</Button></DialogFooter>
            </form>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Página pública do centro (opt-in): liga/desliga, confirmação automática e o link para divulgar. */
function PublicPage({ venue, slug, canEdit, hasCourts, onSaved }: { venue: Venue | null; slug: string; canEdit: boolean; hasCourts: boolean; onSaved: () => void }) {
  const [busy, setBusy] = React.useState(false)
  if (!venue) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Cadastre o perfil do centro primeiro.</p>
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/quadras/${slug}`
  async function set(patch: { public_enabled?: boolean; public_auto_confirm?: boolean }) {
    setBusy(true)
    const r = await supabase().from("court_venues").update(patch).eq("id", venue!.id)
    setBusy(false)
    if (r.error) toast.error(r.error.message); else { toast.success("Configuração salva."); onSaved() }
  }
  return (
    <Card><CardContent className="space-y-4 pt-4">
      <div><h2 className="font-semibold">Página pública e reservas online</h2><p className="text-sm text-muted-foreground">Jogadores e organizadores veem suas quadras, preços e horários livres e solicitam reservas sem criar conta. Os dados privados (CPF/CNPJ, clientes, financeiro) nunca aparecem.</p></div>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4" disabled={!canEdit || busy || (!venue.public_enabled && !hasCourts)} checked={!!venue.public_enabled} onChange={(e) => set({ public_enabled: e.target.checked })} />
        <span><strong>Publicar a página do centro</strong><br /><span className="text-muted-foreground">{hasCourts ? "Desligado, a página e a busca deixam de mostrar o centro." : "Cadastre ao menos uma quadra ativa e os horários de funcionamento antes de publicar."}</span></span></label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4" disabled={!canEdit || busy} checked={!!venue.public_auto_confirm} onChange={(e) => set({ public_auto_confirm: e.target.checked })} />
        <span><strong>Confirmar reservas online automaticamente</strong><br /><span className="text-muted-foreground">Desligado (recomendado), cada solicitação chega como <em>pendente</em> e a sua equipe confirma em Reservas.</span></span></label>
      {venue.public_enabled && (
        <div className="space-y-2 rounded-lg bg-muted p-3 text-sm">
          <p className="font-medium">Link para divulgar</p>
          <p className="break-all">{url}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(url); toast.success("Link copiado.") }}>Copiar link</Button>
            <a className="inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium hover:bg-secondary" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Reserve horário na ${venue.trade_name}: ${url}`)}`}>Compartilhar no WhatsApp</a>
          </div>
          <p className="text-xs text-muted-foreground">Solicitações pendentes aparecem no Dashboard e em Reservas (origem “site”).</p>
        </div>
      )}
    </CardContent></Card>
  )
}
