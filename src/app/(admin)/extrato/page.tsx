"use client"

import { NativeSelect } from "@/components/native-select"
import { SetupNotice } from "@/components/setup-notice"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { guessAthlete, pickCharge, type AthleteLite, type OpenCharge } from "@/lib/extrato"
import { formatBRL, formatCompetence, formatDate } from "@/lib/format"
import { decodeOfx, parseOfx, type OfxTx } from "@/lib/ofx"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import { confirmationMessage, waLink } from "@/lib/whatsapp"
import { CheckCircle2, CircleAlert, FileUp, Loader2, MessageCircle } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Row = { tx: OfxTx; athleteId: string; chargeId: string; include: boolean; certain: boolean; dup: boolean }
type Ctx = { athletes: AthleteLite[]; charges: OpenCharge[]; phones: Map<string, { phone: string | null; consent: boolean; name: string }> }
type Done = { chargeId: string; athleteId: string; amount: number; date: string; competence: string }

const cents = (n: number) => Math.round(n * 100)

export default function ExtratoPage() {
  const [rows, setRows] = React.useState<Row[] | null>(null)
  const [ctx, setCtx] = React.useState<Ctx | null>(null)
  const [meta, setMeta] = React.useState<{ file: string; debits: number }>({ file: "", debits: 0 })
  const [reading, setReading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [done, setDone] = React.useState<Done[] | null>(null)
  const [auto, setAuto] = React.useState<boolean | null>(null)
  const [sendAuto, setSendAuto] = React.useState(true)
  const [report, setReport] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    fetch("/api/whatsapp").then((r) => r.json()).then((j) => setAuto(!!j.configured), () => setAuto(false))
  }, [])
  if (!supabaseConfigured) return <SetupNotice />

  async function onFile(file: File) {
    setReading(true); setDone(null); setReport(null)
    try {
      const txs = parseOfx(decodeOfx(await file.arrayBuffer()))
      if (!txs.length) throw new Error("Não encontrei transações neste arquivo. Baixe o extrato do Itaú no formato OFX.")
      const credits = txs.filter((t) => t.amount > 0)
      const sb = supabase()
      const [a, c, ch] = await Promise.all([
        sb.from("athletes").select("id, full_name, nickname, active, phone, whatsapp_consent"),
        sb.from("charges_view").select("id, athlete_id, competence, balance").gt("balance", 0),
        (async () => {
          const used = new Set<string>()
          const ids = credits.map((t) => t.fitid)
          for (let i = 0; i < ids.length; i += 150) {
            const r = await sb.from("payments").select("bank_txid").in("bank_txid", ids.slice(i, i + 150))
            if (r.error) throw new Error(r.error.message)
            for (const x of r.data as { bank_txid: string }[]) used.add(x.bank_txid)
          }
          return used
        })(),
      ])
      if (a.error) throw new Error(a.error.message)
      if (c.error) throw new Error(c.error.message)
      const athletes = a.data as (AthleteLite & { phone: string | null; whatsapp_consent: boolean })[]
      const charges = (c.data as OpenCharge[]).map((x) => ({ ...x, balance: Number(x.balance) }))
      const next: Row[] = credits.map((tx) => {
        if (ch.has(tx.fitid)) return { tx, athleteId: "", chargeId: "", include: false, certain: false, dup: true }
        const g = guessAthlete(tx.memo, athletes)
        const charge = g.athlete ? pickCharge(charges, g.athlete.id, tx.amount) : null
        return { tx, athleteId: g.athlete?.id ?? "", chargeId: charge?.id ?? "", include: g.certain && !!charge, certain: g.certain && !!charge, dup: false }
      })
      setCtx({ athletes, charges, phones: new Map(athletes.map((x) => [x.id, { phone: x.phone, consent: x.whatsapp_consent, name: x.nickname || x.full_name.split(" ")[0] }])) })
      setRows(next); setMeta({ file: file.name, debits: txs.length - credits.length })
    } catch (e) {
      setRows(null); toast.error(e instanceof Error ? e.message : String(e))
    } finally { setReading(false); if (fileRef.current) fileRef.current.value = "" }
  }

  const patch = (i: number, p: Partial<Row>) => setRows((r) => r && r.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const chargesOf = (athleteId: string) => (ctx?.charges ?? []).filter((c) => c.athlete_id === athleteId).sort((a, b) => a.competence.localeCompare(b.competence))
  function setAthlete(i: number, id: string) {
    const r = rows![i]
    const ch = id ? pickCharge(ctx!.charges, id, r.tx.amount) : null
    patch(i, { athleteId: id, chargeId: ch?.id ?? "", certain: false, include: false })
  }
  /** Um mesmo saldo não pode ser usado por duas linhas ao mesmo tempo. */
  const problems = (list: Row[]) => {
    const left = new Map((ctx?.charges ?? []).map((c) => [c.id, cents(c.balance)]))
    const bad = new Set<number>()
    list.forEach((r, i) => {
      if (!r.include) return
      const rest = left.get(r.chargeId)
      if (!r.athleteId || !r.chargeId || rest == null || cents(r.tx.amount) > rest) { bad.add(i); return }
      left.set(r.chargeId, rest - cents(r.tx.amount))
    })
    return bad
  }
  const bad = rows ? problems(rows) : new Set<number>()
  const selected = rows ? rows.filter((r, i) => r.include && !bad.has(i)) : []

  async function confirm() {
    if (!rows || !ctx) return
    setSaving(true); setReport(null)
    const ok: Done[] = []; const fails: string[] = []
    for (const r of selected) {
      const ch = ctx.charges.find((c) => c.id === r.chargeId)!
      const { error } = await supabase().from("payments").insert({
        athlete_id: r.athleteId, charge_id: r.chargeId, amount: r.tx.amount, paid_at: r.tx.date,
        method: "pix", source: "extrato", bank_txid: r.tx.fitid, notes: r.tx.memo.slice(0, 200),
      })
      if (error) fails.push(`${formatDate(r.tx.date)} ${formatBRL(r.tx.amount)}: ${error.message.includes("bank_txid_uniq") ? "já importado" : error.message}`)
      else ok.push({ chargeId: r.chargeId, athleteId: r.athleteId, amount: r.tx.amount, date: r.tx.date, competence: ch.competence })
    }
    let msg = `${ok.length} pagamento(s) registrado(s).`
    if (fails.length) msg += ` ${fails.length} falhou(aram): ${fails.join("; ")}`
    if (ok.length && auto && sendAuto) {
      const res = await fetch("/api/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ charge_ids: [...new Set(ok.map((d) => d.chargeId))] }) })
      const j = (await res.json().catch(() => ({}))) as { error?: string; results?: { status: string; detail?: string }[] }
      if (!res.ok) msg += ` WhatsApp: ${j.error ?? "erro"}.`
      else {
        const c = (s: string) => (j.results ?? []).filter((x) => x.status === s).length
        msg += ` WhatsApp: ${c("enviado")} enviado(s), ${c("ignorado")} ignorado(s)${c("falhou") ? `, ${c("falhou")} com falha` : ""}.`
        const why = (j.results ?? []).filter((x) => x.status !== "enviado" && x.detail).map((x) => x.detail!)
        if (why.length) msg += ` (${[...new Set(why)].join(" · ")})`
      }
    }
    setReport(msg); setDone(ok)
    ;(fails.length ? toast.error : toast.success)(fails.length ? "Alguns pagamentos não foram registrados." : "Pagamentos registrados.")
    // remove da lista o que foi gravado; o resto continua para nova tentativa
    const okTx = new Set(selected.filter((r) => ok.some((d) => d.chargeId === r.chargeId && d.date === r.tx.date && d.amount === r.tx.amount)).map((r) => r.tx.fitid))
    setRows((cur) => cur && cur.map((r) => (okTx.has(r.tx.fitid) ? { ...r, dup: true, include: false } : r)))
    setSaving(false)
  }

  const manual = (done ?? []).map((d) => {
    const a = ctx?.phones.get(d.athleteId)
    return a?.phone && a.consent ? { d, a, url: waLink(a.phone, confirmationMessage({ name: a.name, competence: d.competence, amount: d.amount, paidAt: d.date })) } : null
  }).filter(Boolean) as { d: Done; a: { name: string }; url: string }[]
  const counts = rows ? { ready: rows.filter((r) => r.certain && !r.dup).length, review: rows.filter((r) => !r.certain && !r.dup).length, dup: rows.filter((r) => r.dup).length } : null

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Extrato bancário</h1>
        <div>
          <input ref={fileRef} type="file" accept=".ofx,.OFX,.txt" className="sr-only" id="ofx" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <Button variant="brand" disabled={reading} onClick={() => fileRef.current?.click()}>{reading ? <Loader2 className="animate-spin" /> : <FileUp />} Importar extrato (OFX)</Button>
        </div>
      </div>
      <Card><CardContent className="space-y-1 pt-4 text-sm text-muted-foreground">
        <p><b className="text-foreground">Como usar:</b> no Itaú (internet banking), abra <i>Extrato</i> da conta e salve o período em <b>OFX</b>. Envie o arquivo aqui. O arquivo é lido no seu navegador; só os pagamentos que você confirmar são gravados.</p>
        <p>O sistema reconhece o atleta pelo nome do pagador. Só marca sozinho quando há um único atleta com aquele nome e uma mensalidade em aberto do mesmo valor. O resto fica para você conferir. Um mesmo Pix nunca é registrado duas vezes.</p>
        <p>O Itaú pessoa física não envia aviso de Pix para sistemas: por isso a importação é feita por você, quantas vezes quiser (por exemplo, uma vez ao dia).</p>
      </CardContent></Card>

      {rows && counts && (
        <>
          <p className="text-sm"><b>{meta.file}</b>: {rows.length} crédito(s) · <span className="text-green-700">{counts.ready} pronto(s)</span> · <span className="text-[#B4151B]">{counts.review} a conferir</span> · {counts.dup} já registrado(s) · {meta.debits} débito(s) ignorado(s)</p>
          {rows.length === 0 ? <Card><CardContent className="pt-4 text-sm text-muted-foreground">Nenhum crédito neste arquivo.</CardContent></Card> : (
            <Card className="overflow-hidden py-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-10 pl-4" /><TableHead>Data</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>No extrato</TableHead><TableHead>Atleta</TableHead><TableHead>Mensalidade</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={r.tx.fitid} className={r.dup ? "opacity-50" : undefined}>
                        <TableCell className="pl-4"><input type="checkbox" aria-label={`Registrar ${formatBRL(r.tx.amount)} de ${formatDate(r.tx.date)}`} className="size-4 accent-[#1C3D63]" disabled={r.dup || !r.athleteId || !r.chargeId} checked={r.include} onChange={(e) => patch(i, { include: e.target.checked })} /></TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(r.tx.date)}</TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">{formatBRL(r.tx.amount)}</TableCell>
                        <TableCell className="max-w-56 truncate" title={r.tx.memo}>{r.tx.memo || "—"}</TableCell>
                        <TableCell>
                          <NativeSelect aria-label="Atleta" className="w-44" disabled={r.dup} value={r.athleteId} onChange={(e) => setAthlete(i, e.target.value)}>
                            <option value="">— escolher —</option>
                            {(ctx?.athletes ?? []).slice().sort((x, y) => x.full_name.localeCompare(y.full_name)).map((a) => <option key={a.id} value={a.id}>{a.full_name}{a.active ? "" : " (inativo)"}</option>)}
                          </NativeSelect>
                        </TableCell>
                        <TableCell>
                          <NativeSelect aria-label="Mensalidade" className="w-44" disabled={r.dup || !r.athleteId} value={r.chargeId} onChange={(e) => patch(i, { chargeId: e.target.value, include: false, certain: false })}>
                            <option value="">{r.athleteId && !chargesOf(r.athleteId).length ? "sem mensalidade em aberto" : "— escolher —"}</option>
                            {chargesOf(r.athleteId).map((c) => <option key={c.id} value={c.id}>{formatCompetence(c.competence)} · saldo {formatBRL(c.balance)}</option>)}
                          </NativeSelect>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {r.dup ? "Já registrado" : bad.has(i) ? <span className="text-[#B4151B]">Valor maior que o saldo ou mensalidade repetida</span>
                            : r.certain ? <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="size-3.5" /> Pronto</span>
                            : <span className="inline-flex items-center gap-1 text-[#B4151B]"><CircleAlert className="size-3.5" /> Conferir</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="brand" disabled={!selected.length || saving} onClick={confirm}>{saving && <Loader2 className="animate-spin" />} Registrar {selected.length} pagamento(s)</Button>
            {auto === true && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[#1C3D63]" checked={sendAuto} onChange={(e) => setSendAuto(e.target.checked)} /> Enviar confirmação por WhatsApp aos atletas</label>}
            {auto === false && <span className="text-xs text-muted-foreground">WhatsApp automático ainda não configurado: depois de registrar, aparecem os botões para enviar com um clique.</span>}
          </div>
        </>
      )}

      {report && <Card><CardContent className="pt-4 text-sm" role="status">{report}</CardContent></Card>}
      {done && done.length > 0 && !(auto && sendAuto) && (
        <Card><CardContent className="space-y-2 pt-4">
          <p className="text-sm font-medium">Enviar agradecimento por WhatsApp (um clique cada):</p>
          {manual.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum destes atletas tem telefone e consentimento cadastrados.</p> : (
            <ul className="flex flex-wrap gap-2">
              {manual.map((m) => <li key={m.d.chargeId}><a className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm hover:bg-secondary" href={m.url} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-4" /> {m.a.name}</a></li>)}
            </ul>
          )}
        </CardContent></Card>
      )}
    </>
  )
}
