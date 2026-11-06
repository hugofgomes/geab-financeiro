"use client"

import { NativeSelect } from "@/components/native-select"
import { PixSettings } from "@/components/pix-settings"
import { SetupNotice } from "@/components/setup-notice"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLoad } from "@/hooks/use-load"
import { addMonths, formatBRL, formatCompetence, formatDate, monthKey } from "@/lib/format"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Athlete, Charge, DisplayStatus, PixCharge } from "@/lib/types"
import { confirmationMessage, waLink } from "@/lib/whatsapp"
import { ChevronLeft, ChevronRight, Copy, Loader2, MessageCircle, Pencil, Plus, QrCode, Trash2, TriangleAlert, Wand2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Row = Charge & { athlete: Pick<Athlete, "full_name" | "nickname" | "phone" | "whatsapp_consent"> }
const today = () => new Date().toISOString().slice(0, 10)

function PaymentDialog({ row, onClose, onSaved }: { row: Row | null; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = React.useState("")
  const [date, setDate] = React.useState(today())
  const [method, setMethod] = React.useState("pix")
  const [txid, setTxid] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (row) { setAmount(String(row.balance)); setDate(today()); setMethod("pix"); setTxid(""); setNotes("") } }, [row])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!row) return
    const value = Number(amount.replace(",", "."))
    if (!Number.isFinite(value) || value <= 0) return toast.error("Informe um valor maior que zero.")
    if (value > row.balance + 0.001) return toast.error(`O valor excede o saldo da mensalidade (${formatBRL(row.balance)}).`)
    setBusy(true)
    const { error } = await supabase().from("payments").insert({
      athlete_id: row.athlete_id, charge_id: row.id, amount: value, paid_at: date, method,
      bank_txid: txid.trim() || null, notes: notes.trim() || null,
    })
    setBusy(false)
    if (error) return toast.error(error.message.includes("payments_bank_txid_uniq") ? "Este identificador bancário já foi usado em outro pagamento." : error.message)
    toast.success("Pagamento registrado.")
    // Aviso por e-mail ao atleta (só envia se a mensalidade ficou quitada e o servidor tem e-mail configurado).
    fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ charge_ids: [row.id] }) })
      .then((r) => r.json()).then((j) => {
        const x = j.results?.[0]
        if (x?.status === "enviado") toast.success("E-mail de pagamento enviado ao atleta.")
        else if (x?.status === "falhou") toast.error(`E-mail não enviado: ${x.detail ?? "erro"}`)
        else if (x?.detail === "Atleta sem e-mail válido.") toast.message("Atleta sem e-mail cadastrado: aviso não enviado.")
      }).catch(() => {})
    onSaved()
    onClose()
  }

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Registrar pagamento</DialogTitle></DialogHeader>
        {row && (
          <form onSubmit={save} className="space-y-3">
            <p className="text-sm text-muted-foreground">{row.athlete.full_name} · {formatCompetence(row.competence)} · saldo {formatBRL(row.balance)}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="v">Valor (R$)</Label><Input id="v" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
              <div className="space-y-1.5"><Label htmlFor="d">Data do pagamento</Label><Input id="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="m">Forma</Label>
              <NativeSelect id="m" className="w-full" value={method} onChange={(e) => setMethod(e.target.value)}><option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option><option value="outro">Outro</option></NativeSelect>
            </div>
            <div className="space-y-1.5"><Label htmlFor="t">Identificador bancário (opcional)</Label><Input id="t" value={txid} onChange={(e) => setTxid(e.target.value)} placeholder="ID da transação no comprovante" /></div>
            <div className="space-y-1.5"><Label htmlFor="n">Observação</Label><Input id="n" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Registrar</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Edição de uma mensalidade pela Diretoria: qualquer valor (0 = isenção) e vencimento. */
function EditChargeDialog({ row, onClose, onSaved }: { row: Row | null; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = React.useState("")
  const [due, setDue] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (row) { setAmount(String(row.amount).replace(".", ",")); setDue(row.due_date) } }, [row])
  if (!row) return null
  const cur = row
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const v = Number(amount.replace(",", "."))
    if (!Number.isFinite(v) || v < 0) return toast.error("Informe um valor válido (0 ou mais).")
    setBusy(true)
    const { error } = await supabase().rpc("admin_update_charge", { p_charge: cur.id, p_amount: v, p_due: due })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Mensalidade atualizada.")
    onSaved(); onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Editar mensalidade</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <p className="text-sm text-muted-foreground">{cur.athlete.full_name} · {formatCompetence(cur.competence)}{cur.paid_total > 0 ? ` · já pago ${formatBRL(cur.paid_total)}` : ""}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="cv">Valor (R$)</Label><Input id="cv" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="cd">Vencimento</Label><Input id="cd" type="date" value={due} onChange={(e) => setDue(e.target.value)} required /></div>
          </div>
          {cur.paid_total > 0 && Number(amount.replace(",", ".")) < cur.paid_total && <p className="text-xs text-amber-600">O novo valor é menor que o já pago ({formatBRL(cur.paid_total)}): a mensalidade ficará como paga e os pagamentos registrados serão mantidos.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function ChargesPage() {
  const [month, setMonth] = React.useState(monthKey())
  const [filter, setFilter] = React.useState<"todos" | DisplayStatus>("todos")
  const [paying, setPaying] = React.useState<Row | null>(null)
  const [editing, setEditing] = React.useState<Row | null>(null)
  const [generating, setGenerating] = React.useState(false)
  const [pixOn, setPixOn] = React.useState(false)
  const [btg, setBtg] = React.useState<{ configured: boolean; connected: boolean }>({ configured: false, connected: false })
  const [pixBusy, setPixBusy] = React.useState(false)
  React.useEffect(() => {
    fetch("/api/pix/cobrancas").then((r) => r.json()).then((j) => {
      setBtg({ configured: j.provider === "btg", connected: !!j.connected })
      setPixOn(!!j.configured && !!j.connected)
    }, () => setPixOn(false))
    const q = new URLSearchParams(window.location.search).get("btg")
    if (q === "ok") toast.success("BTG conectado. Já dá para gerar os Pix.")
    else if (q === "negado") toast.error("Você não autorizou o acesso no BTG.")
    else if (q === "erro") toast.error("Não foi possível conectar o BTG. Tente novamente.")
    else if (q === "nao-configurado") toast.error("O BTG ainda não está configurado no servidor.")
    if (q) window.history.replaceState(null, "", window.location.pathname)
  }, [])

  const { data, error, loading, reload } = useLoad(async () => {
    const sb = supabase()
    const [c, a, n] = await Promise.all([
      sb.from("charges_view").select("*").eq("competence", month),
      sb.from("athletes").select("id, full_name, nickname, phone, whatsapp_consent"),
      sb.from("notifications").select("charge_id, kind, created_at").eq("kind", "confirmacao").neq("channel", "email"),
    ])
    for (const r of [c, a, n]) if (r.error) throw new Error(r.error.message)
    const ath = new Map((a.data as (Athlete & { id: string })[]).map((x) => [x.id, x]))
    const rows = (c.data as Charge[]).map((x) => ({ ...x, athlete: ath.get(x.athlete_id)! })).filter((x) => x.athlete)
    rows.sort((x, y) => x.athlete.full_name.localeCompare(y.athlete.full_name))
    const sent = new Map((n.data as { charge_id: string; created_at: string }[]).map((x) => [x.charge_id, x.created_at]))
    const ids = (c.data as Charge[]).map((x) => x.id)
    const px = ids.length ? await sb.from("pix_charges").select("*").in("charge_id", ids).order("created_at", { ascending: false }) : { data: [] as PixCharge[], error: null }
    if (px.error) throw new Error(px.error.message)
    const pix = new Map<string, PixCharge>()
    for (const x of px.data as PixCharge[]) if (x.status === "ativa" && !pix.has(x.charge_id) && (!x.expires_at || new Date(x.expires_at) > new Date())) pix.set(x.charge_id, x)
    return { rows: rows as Row[], sent, pix, review: (px.data as PixCharge[]).filter((x) => x.review) }
  }, [month])

  if (!supabaseConfigured) return <SetupNotice />

  async function generate() {
    setGenerating(true)
    const { data: n, error } = await supabase().rpc("generate_charges", { p_competence: month })
    setGenerating(false)
    if (error) return toast.error(error.message)
    toast.success(n ? `${n} mensalidade(s) gerada(s).` : "Todas as mensalidades deste mês já existiam.")
    reload()
  }

  async function sendThanks(r: Row) {
    if (!r.athlete.phone || !r.athlete.whatsapp_consent) return toast.error("O atleta não tem telefone ou não consentiu receber mensagens.")
    const p = await supabase().from("payments").select("amount, paid_at").eq("charge_id", r.id).order("paid_at", { ascending: false }).order("created_at", { ascending: false }).limit(1).single()
    if (p.error) return toast.error(p.error.message)
    const text = confirmationMessage({ name: r.athlete.nickname || r.athlete.full_name.split(" ")[0], competence: r.competence, amount: p.data.amount, paidAt: p.data.paid_at })
    window.open(waLink(r.athlete.phone, text), "_blank", "noopener")
    const { error } = await supabase().from("notifications").insert({ athlete_id: r.athlete_id, charge_id: r.id, kind: "confirmacao" })
    if (error) toast.error(`Mensagem aberta, mas o registro falhou: ${error.message}`)
    else reload()
  }

  async function genPix() {
    const ids = (data?.rows ?? []).filter((r) => r.balance > 0).map((r) => r.id)
    if (!ids.length) return toast.info("Não há mensalidades em aberto neste mês.")
    setPixBusy(true)
    const res = await fetch("/api/pix/cobrancas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ charge_ids: ids }) })
    const j = (await res.json().catch(() => ({}))) as { error?: string; results?: { status: string; detail?: string }[] }
    setPixBusy(false)
    if (!res.ok) return toast.error(j.error ?? "Não foi possível gerar os Pix.")
    const n = (s: string) => (j.results ?? []).filter((x) => x.status === s).length
    const fail = (j.results ?? []).find((x) => x.status === "falhou")
    ;(n("falhou") ? toast.error : toast.success)(`${n("criada")} Pix gerado(s), ${n("existente")} já existia(m)${n("falhou") ? `, ${n("falhou")} com falha: ${fail?.detail ?? ""}` : "."}`)
    reload()
  }
  async function removeCharge(r: Row) {
    const base = `Excluir a mensalidade de ${r.athlete.full_name} (${formatCompetence(r.competence)}, ${formatBRL(r.amount)})?`
    const withPay = r.paid_total > 0
    const msg = withPay ? `${base}\n\nATENÇÃO: ela tem ${formatBRL(r.paid_total)} em pagamentos. Eles também serão EXCLUÍDOS e o saldo do caixa diminui nesse valor. Esta ação fica registrada na auditoria e não pode ser desfeita.` : `${base}\n\nEsta ação fica registrada na auditoria.`
    if (!window.confirm(msg)) return
    const { error } = await supabase().rpc("admin_delete_charge", { p_charge: r.id, p_with_payments: withPay })
    if (error) return toast.error(error.message)
    toast.success("Mensalidade excluída.")
    reload()
  }
  async function copyPix(code: string) {
    try { await navigator.clipboard.writeText(code); toast.success("Pix Copia e Cola copiado.") } catch { toast.error("Não foi possível copiar. Use o link do Pix.") }
  }

  const rows = (data?.rows ?? []).filter((r) => filter === "todos" || r.display_status === filter)
  const sum = (f: (r: Row) => number) => (data?.rows ?? []).reduce((a, r) => a + f(r), 0)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Mensalidades</h1>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mês anterior"><ChevronLeft /></Button>
          <span className="min-w-36 text-center font-medium capitalize">{formatCompetence(month)}</span>
          <Button variant="outline" size="icon" onClick={() => setMonth(addMonths(month, 1))} aria-label="Próximo mês"><ChevronRight /></Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={generate} disabled={generating}>{generating ? <Loader2 className="animate-spin" /> : <Wand2 />} Gerar mensalidades do mês</Button>
        <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filtrar por situação">
          <option value="todos">Todas as situações</option><option value="pendente">Pendentes</option><option value="atrasado">Atrasadas</option><option value="parcial">Parcialmente pagas</option><option value="pago">Pagas</option><option value="em_conferencia">Em conferência</option>
        </NativeSelect>
        {btg.configured && !btg.connected && <a href="/api/btg/conectar" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand/90"><QrCode className="size-4" /> Conectar BTG</a>}
        {pixOn && <Button variant="outline" onClick={genPix} disabled={pixBusy || !data?.rows.length}>{pixBusy ? <Loader2 className="animate-spin" /> : <QrCode />} Gerar Pix das pendentes</Button>}
        {data && data.rows.length > 0 && <span className="text-sm text-muted-foreground">Previsto {formatBRL(sum((r) => r.amount))} · recebido {formatBRL(sum((r) => r.paid_total))} · pendente {formatBRL(sum((r) => Math.max(0, r.balance)))}</span>}
      </div>
      <PixSettings />
      {error && <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>}
      {data && data.review.length > 0 && (
        <div role="alert" className="space-y-1 rounded-xl border border-[#F32329]/40 bg-[#F32329]/5 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-[#B4151B]"><TriangleAlert className="size-4" /> Pix recebido que precisa de conferência</p>
          <ul className="list-disc pl-6">{data.review.map((x) => <li key={x.id}>{x.note ?? "Conferir pagamento."} <span className="text-muted-foreground">(cobrança de {formatBRL(x.value_cents / 100)})</span></li>)}</ul>
          <p className="text-xs text-muted-foreground">Estes valores caíram na conta do BTG, mas o sistema não os registrou sozinho. Confira no extrato e registre ou estorne.</p>
        </div>
      )}
      {loading && !data ? <Skeleton className="h-48" /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Atleta</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Pago</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{data?.rows.length ? "Nenhuma mensalidade nesta situação." : "Nenhuma mensalidade neste mês. Use “Gerar mensalidades do mês”."}</TableCell></TableRow>}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.athlete.full_name}</TableCell>
                  <TableCell>{formatDate(r.due_date)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(r.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(r.paid_total)}</TableCell>
                  <TableCell><StatusBadge status={r.display_status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {r.balance > 0 && data?.pix.get(r.id)?.br_code && <Button size="sm" variant="ghost" onClick={() => copyPix(data.pix.get(r.id)!.br_code!)} title="Copiar o Pix Copia e Cola desta mensalidade"><Copy /> Pix</Button>}
                      {r.balance > 0 && <Button size="sm" variant="outline" onClick={() => setPaying(r)}><Plus /> Pagamento</Button>}
                      <Button size="icon-sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Editar mensalidade de ${r.athlete.full_name}`} title="Editar valor e vencimento"><Pencil /></Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => removeCharge(r)} aria-label={`Excluir mensalidade de ${r.athlete.full_name}`} title="Excluir mensalidade"><Trash2 /></Button>
                      {r.display_status === "pago" && <Button size="sm" variant="ghost" onClick={() => sendThanks(r)} title={data?.sent.get(r.id) ? `Agradecimento aberto em ${new Date(data.sent.get(r.id)!).toLocaleString("pt-BR")}` : "Abrir mensagem de agradecimento no WhatsApp"}><MessageCircle /> {data?.sent.has(r.id) ? "Reenviar agradecimento" : "Agradecer"}</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">O agradecimento abre no WhatsApp com o texto pronto, só para mensalidades pagas; quem envia é você. O registro guarda que a mensagem foi aberta, não que foi entregue.</p>
      <PaymentDialog row={paying} onClose={() => setPaying(null)} onSaved={reload} />
      <EditChargeDialog row={editing} onClose={() => setEditing(null)} onSaved={reload} />
    </>
  )
}
