"use client"

import { NativeSelect } from "@/components/native-select"
import { SetupNotice } from "@/components/setup-notice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useLoad } from "@/hooks/use-load"
import { formatDate } from "@/lib/format"
import { supabase, supabaseConfigured } from "@/lib/supabase/client"
import type { Athlete, SignupRequest } from "@/lib/types"
import * as React from "react"
import { toast } from "sonner"

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
const NEW = "novo"

export default function SignupsPage() {
  const { data, error, loading, reload } = useLoad(async () => {
    const sb = supabase()
    const [r, a, p] = await Promise.all([
      sb.from("signup_requests").select("*").order("created_at", { ascending: false }),
      sb.from("athletes").select("id, full_name, nickname, active").order("full_name"),
      sb.from("profiles").select("athlete_id").not("athlete_id", "is", null),
    ])
    for (const x of [r, a, p]) if (x.error) throw new Error(x.error.message)
    const linked = new Set((p.data as { athlete_id: string }[]).map((x) => x.athlete_id))
    return {
      requests: r.data as SignupRequest[],
      free: (a.data as Pick<Athlete, "id" | "full_name" | "nickname" | "active">[]).filter((x) => !linked.has(x.id)),
    }
  }, [])
  const [pick, setPick] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState<string | null>(null)
  if (!supabaseConfigured) return <SetupNotice />

  const pending = (data?.requests ?? []).filter((r) => r.status === "pendente")
  const done = (data?.requests ?? []).filter((r) => r.status !== "pendente").slice(0, 20)
  const suggestion = (r: SignupRequest) => data?.free.find((a) => norm(a.full_name) === norm(r.full_name))?.id ?? NEW

  async function approve(r: SignupRequest) {
    const choice = pick[r.id] ?? suggestion(r)
    setBusy(r.id)
    const { error } = await supabase().rpc("approve_signup", { p_request: r.id, p_athlete: choice === NEW ? null : choice })
    setBusy(null)
    if (error) return toast.error(error.message)
    toast.success(`${r.full_name} aprovado. O acesso ao portal já está liberado.`)
    reload()
  }
  async function reject(r: SignupRequest) {
    if (!window.confirm(`Recusar o cadastro de ${r.full_name}?`)) return
    setBusy(r.id)
    const { error } = await supabase().rpc("reject_signup", { p_request: r.id })
    setBusy(null)
    if (error) return toast.error(error.message)
    toast.success("Cadastro recusado.")
    reload()
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cadastros</h1>
        <p className="text-sm text-muted-foreground">
          Pré-cadastros feitos em <code>/cadastro</code> com e-mail já confirmado. Aprove para criar o atleta (ou vincular a um já existente) e liberar o portal.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">Erro ao carregar: {error}</p>}
      {loading && !data ? <Skeleton className="h-40" /> : (
        <>
          <section className="space-y-3" aria-label="Pendentes">
            <h2 className="text-sm font-medium text-muted-foreground">Aguardando aprovação ({pending.length})</h2>
            {pending.length === 0 && <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">Nenhum cadastro pendente.</p>}
            {pending.map((r) => (
              <div key={r.id} className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="space-y-0.5 text-sm">
                  <div className="font-medium">{r.full_name} {r.nickname && <span className="text-xs font-normal text-muted-foreground">({r.nickname})</span>}</div>
                  <div className="text-muted-foreground">{r.email} · {r.phone ? `+${r.phone}` : "sem WhatsApp"} · {r.birth_date ? `nasc. ${formatDate(r.birth_date)}` : "sem data de nascimento"} · {formatDate(r.created_at.slice(0, 10))}</div>
                  {r.whatsapp_consent && <Badge variant="outline" className="text-[10px]">aceita WhatsApp</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    aria-label={`Atleta para ${r.full_name}`}
                    value={pick[r.id] ?? suggestion(r)}
                    onChange={(e) => setPick((s) => ({ ...s, [r.id]: e.target.value }))}
                    data-write className="max-w-56"
                  >
                    <option value={NEW}>Criar novo atleta</option>
                    <optgroup label="Vincular a atleta existente">
                      {data?.free.map((a) => <option key={a.id} value={a.id}>{a.full_name}{a.active ? "" : " (inativo)"}</option>)}
                    </optgroup>
                  </NativeSelect>
                  <Button data-write size="sm" onClick={() => approve(r)} disabled={busy === r.id}>Aprovar</Button>
                  <Button data-write size="sm" variant="outline" onClick={() => reject(r)} disabled={busy === r.id}>Recusar</Button>
                </div>
              </div>
            ))}
          </section>
          {done.length > 0 && (
            <section className="space-y-2" aria-label="Decididos">
              <h2 className="text-sm font-medium text-muted-foreground">Últimas decisões</h2>
              <ul className="divide-y rounded-xl border bg-card text-sm">
                {done.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span>{r.full_name} <span className="text-muted-foreground">· {r.email}</span></span>
                    <Badge variant={r.status === "aprovado" ? "secondary" : "outline"}>{r.status}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  )
}
