"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { supabase } from "@/lib/supabase/client"
import type { Athlete } from "@/lib/types"
import { normalizePhone } from "@/lib/whatsapp"
import { Loader2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

type Draft = { full_name: string; nickname: string; phone: string; email: string; cpf: string; birth_date: string; monthly_fee: string; due_day: string; whatsapp_consent: boolean; active: boolean }

const empty: Draft = { full_name: "", nickname: "", phone: "", email: "", cpf: "", birth_date: "", monthly_fee: "100", due_day: "10", whatsapp_consent: false, active: true }
const fromAthlete = (a: Athlete): Draft => ({
  full_name: a.full_name, nickname: a.nickname ?? "", phone: a.phone ?? "", email: a.email ?? "", cpf: a.cpf ?? "", birth_date: a.birth_date ?? "",
  monthly_fee: String(a.monthly_fee), due_day: String(a.due_day), whatsapp_consent: a.whatsapp_consent, active: a.active,
})

export function AthleteDialog({ open, athlete, onClose, onSaved }: { open: boolean; athlete: Athlete | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = React.useState<Draft>(empty)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (open) setD(athlete ? fromAthlete(athlete) : empty) }, [open, athlete])
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const fee = Number(d.monthly_fee.replace(",", "."))
    const day = Number(d.due_day)
    if (!d.full_name.trim()) return toast.error("Informe o nome completo.")
    if (!Number.isFinite(fee) || fee < 0) return toast.error("Valor da mensalidade inválido.")
    if (!Number.isInteger(day) || day < 1 || day > 28) return toast.error("O dia de vencimento deve ficar entre 1 e 28.")
    if (d.birth_date && (d.birth_date > new Date().toISOString().slice(0, 10) || d.birth_date < "1900-01-01")) return toast.error("Data de nascimento inválida.")
    if (d.whatsapp_consent && !normalizePhone(d.phone)) return toast.error("Para registrar o consentimento, informe o telefone.")
    const row = {
      full_name: d.full_name.trim(), nickname: d.nickname.trim() || null, phone: normalizePhone(d.phone), email: d.email.trim() || null,
      cpf: d.cpf.replace(/\D/g, "") || null, birth_date: d.birth_date || null, monthly_fee: fee, due_day: day, whatsapp_consent: d.whatsapp_consent, active: d.active,
    }
    setBusy(true)
    const sb = supabase()
    const { error } = athlete ? await sb.from("athletes").update(row).eq("id", athlete.id) : await sb.from("athletes").insert(row)
    setBusy(false)
    if (error) return toast.error(`Não foi possível salvar: ${error.message}`)
    toast.success(athlete ? "Atleta atualizado." : "Atleta cadastrado.")
    onSaved()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{athlete ? "Editar atleta" : "Novo atleta"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="fn">Nome completo *</Label><Input id="fn" value={d.full_name} onChange={(e) => set("full_name", e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="nk">Apelido</Label><Input id="nk" value={d.nickname} onChange={(e) => set("nickname", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="ph">Telefone (WhatsApp)</Label><Input id="ph" inputMode="tel" placeholder="(48) 99999-9999" value={d.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="em">E-mail</Label><Input id="em" type="email" value={d.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="cp">CPF (opcional)</Label><Input id="cp" inputMode="numeric" value={d.cpf} onChange={(e) => set("cpf", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="bd">Data de nascimento</Label><Input id="bd" type="date" min="1900-01-01" value={d.birth_date} onChange={(e) => set("birth_date", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="fee">Mensalidade (R$)</Label><Input id="fee" inputMode="decimal" value={d.monthly_fee} onChange={(e) => set("monthly_fee", e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="dd">Dia do vencimento (1–28)</Label><Input id="dd" inputMode="numeric" value={d.due_day} onChange={(e) => set("due_day", e.target.value)} required /></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={d.whatsapp_consent} onCheckedChange={(v) => set("whatsapp_consent", v)} /> O atleta aceita receber mensagens pelo WhatsApp</label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={d.active} onCheckedChange={(v) => set("active", v)} /> Atleta ativo</label>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
