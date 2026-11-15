"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useLoad } from "@/hooks/use-load"
import { prepareImage } from "@/lib/image"
import { supabase } from "@/lib/supabase/client"
import { ImagePlus, Loader2, Megaphone, Send, X } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Row = { id: string; subject: string; send_email: boolean; show_in_app: boolean; in_app_until: string | null; status: string; orgs_count: number; emails_count: number; sent_count: number; failed_count: number; created_at: string; finished_at: string | null; audience: { statuses?: string[]; plans?: string[] } }
type Detail = { broadcast: { id: string; subject: string; body: string; image_url: string | null; show_in_app: boolean; in_app_until: string | null }; recipients: { email: string; org: string; status: string; error: string | null; sent_at: string | null }[]; dismissed: number }
type Plan = { code: string; name: string; active: boolean }

const STATUSES: [string, string][] = [["ativa", "Ativas"], ["teste", "Em teste"], ["suspensa", "Suspensas"], ["cancelada", "Canceladas"]]
const dtm = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })

async function load() {
  const db = supabase()
  const [b, p] = await Promise.all([db.rpc("sa_broadcasts"), db.rpc("sa_plans")])
  if (b.error) throw new Error(b.error.message)
  return { rows: (b.data ?? []) as Row[], plans: ((p.data ?? []) as Plan[]).filter((x) => x.active) }
}

export default function ComunicadosPage() {
  const { data, error, loading, reload } = useLoad(load, [])
  const [subject, setSubject] = React.useState("")
  const [body, setBody] = React.useState("")
  const [email, setEmail] = React.useState(true)
  const [inApp, setInApp] = React.useState(true)
  const [days, setDays] = React.useState("14")
  const [statuses, setStatuses] = React.useState<string[]>(["ativa", "teste"])
  const [plans, setPlans] = React.useState<string[]>([])    // vazio = todos
  const [preview, setPreview] = React.useState<{ orgs: number; emails: number } | null>(null)
  const [confirm, setConfirm] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState<{ id: string; sent: number; failed: number; pending: number; total: number } | null>(null)
  const [detail, setDetail] = React.useState<Detail | null>(null)
  const [image, setImage] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!statuses.length) { setPreview(null); return }
    let alive = true
    const t = setTimeout(() => { supabase().rpc("sa_broadcast_preview", { p_statuses: statuses, p_plans: plans }).then((r) => { if (alive && !r.error) setPreview(r.data as { orgs: number; emails: number }) }) }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [statuses, plans])

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) return toast.error("Use uma imagem PNG, JPG ou WebP.")
    if (f.size > 12_000_000) return toast.error("Imagem muito grande (máximo 12 MB).")
    setUploading(true)
    try {
      const blob = await prepareImage(f)
      const path = `${crypto.randomUUID()}.jpg`
      const up = await supabase().storage.from("comunicados").upload(path, blob, { contentType: "image/jpeg", upsert: false })
      if (up.error) throw new Error(up.error.message)
      setImage(supabase().storage.from("comunicados").getPublicUrl(path).data.publicUrl)
    } catch (err) { toast.error(err instanceof Error ? err.message : "Não foi possível enviar a imagem.") }
    setUploading(false)
  }

  const toggle = (arr: string[], v: string, set: (a: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  /** Envia os e-mails em lotes (a rota manda até 15 por chamada) até não restar pendentes. */
  async function deliver(id: string, total: number) {
    setProgress({ id, sent: 0, failed: 0, pending: total, total })
    for (let i = 0; i < 400; i++) {
      const r = await fetch("/api/super/comunicados/enviar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) })
      const j = (await r.json().catch(() => ({}))) as { pending?: number; sent?: number; failed?: number; error?: string }
      if (!r.ok) { toast.error(j.error ?? "Falha no envio. Use Continuar envio para tentar de novo."); break }
      setProgress({ id, sent: j.sent ?? 0, failed: j.failed ?? 0, pending: j.pending ?? 0, total })
      if (!j.pending) break
    }
    setProgress(null)
    reload()
  }

  async function send() {
    setBusy(true)
    const r = await supabase().rpc("sa_broadcast_send", { p_subject: subject, p_body: body, p_email: email, p_in_app: inApp, p_statuses: statuses, p_plans: plans, p_in_app_days: Number(days), p_image_url: image })
    setBusy(false); setConfirm(false)
    if (r.error) return toast.error(r.error.message)
    toast.success(email ? "Comunicado criado. Enviando e-mails…" : "Aviso publicado no painel dos clientes.")
    setSubject(""); setBody(""); setImage(null)
    if (email) await deliver(r.data as string, preview?.emails ?? 0); else reload()
  }

  async function test() {
    const r = await fetch("/api/super/comunicados/teste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject, body, imageUrl: image }) })
    const j = (await r.json().catch(() => ({}))) as { error?: string; to?: string }
    if (r.ok) toast.success(`Teste enviado para ${j.to}.`); else toast.error(j.error ?? "Falha no teste.")
  }

  async function open(id: string) {
    const r = await supabase().rpc("sa_broadcast_detail", { p_id: id })
    if (r.error) return toast.error(r.error.message)
    setDetail(r.data as Detail)
  }
  async function retry(id: string, total: number) {
    const r = await supabase().rpc("sa_broadcast_retry", { p_id: id })
    if (r.error) return toast.error(r.error.message)
    setDetail(null)
    await deliver(id, Number(r.data) || total)
  }

  if (error) return <p role="alert" className="text-sm text-destructive">{/Acesso restrito/.test(error) ? "Acesso restrito ao dono da plataforma." : `Erro ao carregar: ${error}`}</p>
  if (loading && !data) return <Skeleton className="h-60" />
  if (!data) return null
  const valid = subject.trim().length >= 3 && body.trim().length >= 3 && (email || inApp) && statuses.length > 0 && (preview?.orgs ?? 0) > 0
  const pct = progress && progress.total ? Math.min(100, Math.round(((progress.sent + progress.failed) / progress.total) * 100)) : 0

  return (
    <>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Megaphone className="size-6" aria-hidden /> Comunicados</h1>
        <p className="text-sm text-muted-foreground">Envie novidades e avisos aos administradores dos grupos clientes, por e-mail e/ou como aviso no painel deles.</p>
      </div>

      {progress && (
        <div role="status" className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium"><Loader2 className="size-4 animate-spin" /> Enviando e-mails… {progress.sent + progress.failed} de {progress.total}{progress.failed ? ` (${progress.failed} falhas)` : ""}</p>
          <div className="h-2 overflow-hidden rounded bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
          <p className="text-xs text-muted-foreground">Mantenha esta página aberta até terminar. Se fechar, volte aqui e use Continuar envio.</p>
        </div>
      )}

      <Card><CardContent className="space-y-4 pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Novo comunicado</h2>
        <div className="space-y-1.5"><Label htmlFor="c-s">Assunto</Label><Input id="c-s" className="h-11 sm:h-9" maxLength={150} placeholder="Ex.: Novidades de novembro" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label htmlFor="c-b">Mensagem</Label>
          <textarea id="c-b" rows={8} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"Olá!\n\nContamos o que há de novo…\n\nLinhas em branco separam os parágrafos. Links https:// ficam clicáveis."}
            className="w-full rounded-lg border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm" />
          <p className="text-right text-xs text-muted-foreground">{body.length}/5000</p>
        </div>

        <div className="space-y-2">
          <Label>Imagem <span className="font-normal text-muted-foreground">(opcional · PNG, JPG ou WebP)</span></Label>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pick} aria-label="Escolher imagem" />
          {image ? (
            <div className="relative w-full max-w-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="Imagem do comunicado" className="max-h-56 w-full rounded-lg border object-cover" />
              <button type="button" onClick={() => setImage(null)} aria-label="Remover imagem" className="absolute top-2 right-2 grid size-10 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"><X className="size-4" /></button>
            </div>
          ) : (
            <Button type="button" variant="outline" className="h-11 w-full sm:h-9 sm:w-auto" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />} {uploading ? "Enviando imagem…" : "Adicionar imagem"}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">A imagem é reduzida para 1200 px e convertida para JPG. Alguns leitores de e-mail pedem para o cliente liberar a exibição de imagens.</p>
        </div>

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Canais</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={email} onChange={(e) => setEmail(e.target.checked)} /> E-mail para os administradores e o responsável de cada grupo</label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={inApp} onChange={(e) => setInApp(e.target.checked)} /> Aviso dentro do painel (administrador e diretoria)
            {inApp && <span className="ml-1 flex items-center gap-1 text-xs text-muted-foreground">por <Input aria-label="Dias de exibição" className="h-9 w-16" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /> dias</span>}</label>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset><legend className="mb-1 text-sm font-medium">Situação do cliente</legend>
            <div className="grid grid-cols-2">{STATUSES.map(([k, l]) => <label key={k} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={statuses.includes(k)} onChange={() => toggle(statuses, k, setStatuses)} /> {l}</label>)}</div></fieldset>
          <fieldset><legend className="mb-1 text-sm font-medium">Plano <span className="font-normal text-muted-foreground">(nenhum marcado = todos)</span></legend>
            <div className="grid grid-cols-2">{data.plans.map((p) => <label key={p.code} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={plans.includes(p.code)} onChange={() => toggle(plans, p.code, setPlans)} /> {p.name}</label>)}</div></fieldset>
        </div>

        <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm">
          {preview ? <>Vai para <b>{preview.orgs}</b> grupo(s){email ? <> e <b>{preview.emails}</b> e-mail(s)</> : null}. Clientes excluídos e quem pediu para não receber ficam de fora.</> : "Escolha a situação para ver quantos clientes recebem."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11 w-full sm:h-9 sm:w-auto" disabled={!email || uploading || subject.trim().length < 3 || body.trim().length < 3} onClick={test}>Enviar teste para mim</Button>
          <Button variant="brand" className="h-11 w-full sm:h-9 sm:w-auto" disabled={!valid || busy || uploading || !!progress} onClick={() => setConfirm(true)}><Send /> Enviar comunicado</Button>
        </div>
      </CardContent></Card>

      <Card><CardContent className="space-y-3 pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Histórico ({data.rows.length})</h2>
        {data.rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum comunicado enviado ainda.</p>}
        <ul className="divide-y">
          {data.rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div className="min-w-0">
                <button type="button" onClick={() => open(r.id)} className="block min-h-8 text-left font-medium text-primary hover:underline">{r.subject}</button>
                <p className="text-xs text-muted-foreground">{dtm(r.created_at)} · {r.orgs_count} grupo(s){r.send_email ? ` · ${r.sent_count}/${r.emails_count} e-mails${r.failed_count ? `, ${r.failed_count} com falha` : ""}` : ""}{r.show_in_app ? " · aviso no painel" : ""}</p>
              </div>
              {r.status === "enviando"
                ? <Button size="sm" variant="outline" className="h-10 sm:h-8" disabled={!!progress} onClick={() => deliver(r.id, r.emails_count - r.sent_count - r.failed_count)}>Continuar envio</Button>
                : <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">Enviado</span>}
            </li>
          ))}
        </ul>
      </CardContent></Card>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Enviar comunicado?</DialogTitle><DialogDescription>Esta ação não pode ser desfeita.</DialogDescription></DialogHeader>
          <div className="space-y-1 text-sm"><p className="font-medium">{subject}</p>
            <p>{preview?.orgs} grupo(s){email ? `, ${preview?.emails} e-mail(s)` : ""}{inApp ? ` · aviso no painel por ${days} dia(s)` : ""}{image ? " · com imagem" : ""}.</p></div>
          <DialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>Cancelar</Button><Button variant="brand" disabled={busy} onClick={send}>{busy && <Loader2 className="animate-spin" />} Enviar agora</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85dvh] overflow-x-hidden overflow-y-auto sm:max-w-lg">
          {detail && <>
            <DialogHeader><DialogTitle>{detail.broadcast.subject}</DialogTitle><DialogDescription>{detail.recipients.length} destinatário(s){detail.broadcast.show_in_app ? ` · ${detail.dismissed} dispensaram o aviso no painel` : ""}</DialogDescription></DialogHeader>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {detail.broadcast.image_url && <img src={detail.broadcast.image_url} alt="" className="max-h-56 w-full rounded-lg border object-cover" />}
            <p className="whitespace-pre-wrap break-words rounded-lg bg-secondary/60 p-3 text-sm">{detail.broadcast.body}</p>
            <ul className="divide-y text-sm">
              {detail.recipients.map((x) => (
                <li key={x.email} className="flex items-start justify-between gap-2 py-2">
                  <span className="min-w-0"><span className="block truncate">{x.email}</span><span className="block break-words text-xs text-muted-foreground">{x.org}{x.error ? ` · ${x.error}` : ""}</span></span>
                  <span className={`shrink-0 text-xs font-medium ${x.status === "enviado" ? "text-green-700" : x.status === "falhou" ? "text-destructive" : "text-muted-foreground"}`}>{x.status === "enviado" ? "Enviado" : x.status === "falhou" ? "Falhou" : "Pendente"}</span>
                </li>
              ))}
            </ul>
            {detail.recipients.some((x) => x.status === "falhou") && <DialogFooter><Button variant="outline" onClick={() => retry(detail.broadcast.id, detail.recipients.filter((x) => x.status === "falhou").length)}>Reenviar as falhas</Button></DialogFooter>}
          </>}
        </DialogContent>
      </Dialog>
    </>
  )
}
