"use client"

import { NativeSelect } from "@/components/native-select"
import { SetupNotice } from "@/components/setup-notice"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLoad } from "@/hooks/use-load"
import { brToday, hhmm, MATCHES_CHANGED, shortDate, weekdayOf } from "@/lib/matches"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Match, MatchStatus } from "@/lib/types"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

const STATUS: Record<MatchStatus, string> = { agendado: "Agendado", em_andamento: "Em andamento", finalizado: "Finalizado" }
type Form = { date: string; time: string; a: string; b: string; sa: string; sb: string; status: MatchStatus }
const blank = (): Form => ({ date: brToday(), time: "", a: "Equipe Azul", b: "Equipe Branca", sa: "", sb: "", status: "agendado" })

function MatchDialog({ m, onClose, onSaved }: { m: Match | "novo" | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState<Form>(blank())
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (m === "novo") setF(blank())
    else if (m) setF({ date: m.match_date, time: hhmm(m.match_time) ?? "", a: m.team_a, b: m.team_b, sa: m.score_a == null ? "" : String(m.score_a), sb: m.score_b == null ? "" : String(m.score_b), status: m.status })
  }, [m])
  if (!m) return null
  const cur = m
  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }))
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const hasScore = f.sa !== "" || f.sb !== ""
    const sa = f.sa === "" ? null : Number(f.sa), sb = f.sb === "" ? null : Number(f.sb)
    if (f.a.trim().toLowerCase() === f.b.trim().toLowerCase()) return toast.error("As equipes precisam ter nomes diferentes.")
    if (f.status === "finalizado" && (sa == null || sb == null)) return toast.error("Informe o placar das duas equipes para finalizar o jogo.")
    if (hasScore && (sa == null || sb == null)) return toast.error("Preencha o placar das duas equipes (ou deixe ambos vazios).")
    for (const v of [sa, sb]) if (v != null && (!Number.isInteger(v) || v < 0 || v > 99)) return toast.error("O placar deve ser um número inteiro de 0 a 99.")
    const row = { match_date: f.date, match_time: f.time || null, team_a: f.a.trim(), team_b: f.b.trim(), score_a: sa, score_b: sb, status: f.status }
    setBusy(true)
    const sb_ = supabase()
    const { error } = cur === "novo" ? await sb_.from("matches").insert(row) : await sb_.from("matches").update(row).eq("id", cur.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(m === "novo" ? "Jogo cadastrado." : "Jogo atualizado.")
    onSaved(); onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{m === "novo" ? "Novo jogo" : "Editar jogo"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="jd">Data</Label><Input id="jd" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="jh">Horário <span className="font-normal text-muted-foreground">(opcional)</span></Label><Input id="jh" type="time" value={f.time} onChange={(e) => set("time", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="ja">Equipe 1</Label><Input id="ja" maxLength={40} value={f.a} onChange={(e) => set("a", e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="jb">Equipe 2</Label><Input id="jb" maxLength={40} value={f.b} onChange={(e) => set("b", e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="jsa">Gols da equipe 1</Label><Input id="jsa" type="number" inputMode="numeric" min={0} max={99} value={f.sa} onChange={(e) => set("sa", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="jsb">Gols da equipe 2</Label><Input id="jsb" type="number" inputMode="numeric" min={0} max={99} value={f.sb} onChange={(e) => set("sb", e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="js">Situação</Label>
            <NativeSelect id="js" className="w-full" value={f.status} onChange={(e) => set("status", e.target.value)}>
              {(Object.keys(STATUS) as MatchStatus[]).map((k) => <option key={k} value={k}>{STATUS[k]}</option>)}
            </NativeSelect></div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function MatchesPage() {
  const { data, error, loading, reload } = useLoad(async () => {
    const { data, error } = await supabase().from("matches").select("*").order("match_date", { ascending: false }).order("match_time", { ascending: false, nullsFirst: false })
    if (error) throw new Error(error.message)
    return data as Match[]
  }, [])
  const [editing, setEditing] = React.useState<Match | "novo" | null>(null)
  if (!supabaseConfigured) return <SetupNotice />
  const changed = () => { reload(); window.dispatchEvent(new Event(MATCHES_CHANGED)) }

  async function remove(m: Match) {
    if (!window.confirm(`Excluir o jogo de ${shortDate(m.match_date)} (${m.team_a} × ${m.team_b})?`)) return
    const { error } = await supabase().from("matches").delete().eq("id", m.id)
    if (error) return toast.error(error.message)
    toast.success("Jogo excluído.")
    changed()
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Jogos</h1>
        <Button variant="brand" onClick={() => setEditing("novo")}><Plus /> Novo jogo</Button>
      </div>
      <p className="text-sm text-muted-foreground">Os resultados e o próximo jogo aparecem na barra lateral para toda a diretoria e para os atletas. Os aniversários vêm da data de nascimento do cadastro de cada atleta (edite em Atletas).</p>
      {error && <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>}
      {loading && !data && <Skeleton className="h-40" />}
      {data && (data.length === 0 ? (
        <Card><CardContent className="pt-4 text-sm text-muted-foreground">Nenhum jogo cadastrado. Use “Novo jogo” para registrar um resultado ou agendar o próximo.</CardContent></Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader><TableRow><TableHead className="pl-4">Data</TableHead><TableHead>Jogo</TableHead><TableHead className="text-center">Placar</TableHead><TableHead>Situação</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
            <TableBody>
              {data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="pl-4 whitespace-nowrap">{shortDate(m.match_date)} <span className="text-xs text-muted-foreground">{weekdayOf(m.match_date).slice(0, 3)}{hhmm(m.match_time) ? ` · ${hhmm(m.match_time)}` : ""}</span></TableCell>
                  <TableCell>{m.team_a} <span className="text-muted-foreground">×</span> {m.team_b}</TableCell>
                  <TableCell className="text-center font-semibold tabular-nums">{m.score_a == null ? "–" : `${m.score_a} × ${m.score_b}`}</TableCell>
                  <TableCell>{STATUS[m.status]}</TableCell>
                  <TableCell><div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditing(m)} aria-label={`Editar jogo de ${shortDate(m.match_date)}`}><Pencil /></Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(m)} aria-label={`Excluir jogo de ${shortDate(m.match_date)}`}><Trash2 /></Button>
                  </div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ))}
      <MatchDialog m={editing} onClose={() => setEditing(null)} onSaved={changed} />
    </>
  )
}
