"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import Link from "next/link"
import * as React from "react"

type Billing = { org_name: string; status: string; usable: boolean; trial_days_left: number | null; plan_name: string; price_cents: number; max_athletes: number | null; paid_until: string | null; is_admin: boolean; has_subscription: boolean }
type Plan = { code: string; name: string; price_cents: number; max_athletes: number | null }
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 })

function headline(b: Billing) {
  if (b.status === "teste" && b.usable) return { t: `Teste gratuito: ${b.trial_days_left === 1 ? "último dia" : `${b.trial_days_left} dias restantes`}`, d: "Assine agora para não perder o acesso quando o teste terminar." }
  if (b.status === "teste") return { t: "Seu teste gratuito terminou", d: "Seus dados estão guardados e voltam assim que a assinatura for confirmada." }
  if (b.status === "suspensa") return { t: "Pagamento pendente", d: "O acesso foi suspenso por falta de pagamento. Regularize para voltar, sem perder nenhum dado." }
  if (b.status === "cancelada") return { t: "Assinatura cancelada", d: "Para reativar o grupo, fale com o suporte." }
  return { t: `Plano ${b.plan_name} ativo`, d: b.paid_until ? `Pago até ${new Date(b.paid_until).toLocaleDateString("pt-BR")}.` : "Tudo em dia." }
}

export default function SubscriptionPage() {
  const [b, setB] = React.useState<Billing | null | undefined>(undefined)
  const [plans, setPlans] = React.useState<Plan[]>([])
  const [plan, setPlan] = React.useState("basico")
  const [doc, setDoc] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [blk, setBlk] = React.useState<{ kind: string; reason: string | null; suspended_at: string | null } | null>(null)

  React.useEffect(() => {
    const sb = supabase()
    sb.rpc("my_billing").then((r) => setB(((r.data as Billing[] | null) ?? [])[0] ?? null))
    sb.rpc("my_org_block").then((r) => setBlk(((r.data as { kind: string; reason: string | null; suspended_at: string | null }[] | null) ?? [])[0] ?? null))
    sb.rpc("billing_plans").then((r) => setPlans((r.data as Plan[] | null) ?? []))
  }, [])

  async function subscribe(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const res = await fetch("/api/assinatura", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, cpfCnpj: doc }) })
      const j = (await res.json()) as { url?: string; error?: string }
      if (j.url) { window.location.href = j.url; return }
      setErr(j.error ?? "Não foi possível continuar.")
    } catch { setErr("Sem conexão. Tente novamente.") } finally { setBusy(false) }
  }
  async function signOut() { await supabase().auth.signOut(); window.location.href = "/login" }

  if (b === undefined) return <main className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Carregando…</main>
  if (b === null) return <main className="grid min-h-dvh place-items-center p-6 text-center text-sm"><div>Não encontramos o seu grupo. <Link href="/login" className="underline">Entrar</Link></div></main>
  if (blk?.kind === "manual" || blk?.kind === "excluida") {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-4 py-10 text-center">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{b.org_name}</p>
          <h1 className="text-2xl font-bold text-primary">{blk.kind === "excluida" ? "Este grupo está indisponível" : "Acesso temporariamente indisponível"}</h1>
          <p className="text-sm text-muted-foreground">
            {blk.kind === "excluida"
              ? "O grupo foi encerrado na plataforma. Se isso não era esperado, fale com o suporte: seus dados podem ainda estar disponíveis para recuperação."
              : "O acesso deste grupo foi suspenso temporariamente. Seus dados continuam guardados e voltam assim que o acesso for restabelecido."}
          </p>
          {blk.kind === "manual" && blk.reason && <p className="rounded-xl border bg-secondary p-3 text-sm"><span className="font-medium">Motivo:</span> {blk.reason}</p>}
          <p className="text-sm">Entre em contato com o suporte para regularizar a situação.</p>
          <button onClick={signOut} className="text-sm text-muted-foreground underline">Sair</button>
        </div>
      </main>
    )
  }
  const h = headline(b)
  const canPay = b.is_admin && b.status !== "cancelada" && !(b.status === "ativa" && b.has_subscription)
  return (
    <main className="mx-auto min-h-dvh max-w-xl space-y-6 px-4 py-10">
      <div className="space-y-1 text-center">
        <p className="text-sm text-muted-foreground">{b.org_name}</p>
        <h1 className="text-2xl font-bold text-primary">{h.t}</h1>
        <p className="text-sm text-muted-foreground">{h.d}</p>
      </div>

      {!b.is_admin && <p role="note" className="rounded-xl border bg-secondary p-4 text-center text-sm">Somente o administrador do grupo pode assinar. Peça a ele para acessar esta página.</p>}

      {canPay && (
        <form onSubmit={subscribe} className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">Escolha o plano</legend>
            {plans.map((p) => (
              <label key={p.code} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition", plan === p.code ? "border-primary bg-secondary" : "hover:bg-secondary/60")}>
                <input type="radio" name="plan" className="sr-only" checked={plan === p.code} onChange={() => setPlan(p.code)} />
                <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-full border", plan === p.code ? "border-primary bg-primary text-primary-foreground" : "")}>{plan === p.code && <Check className="size-3" />}</span>
                <span className="flex-1"><span className="block font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">até {p.max_athletes ?? "∞"} jogadores</span></span>
                <span className="font-semibold tabular-nums">{brl(p.price_cents)}<span className="text-xs font-normal text-muted-foreground">/mês</span></span>
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">CPF ou CNPJ de quem paga</span>
            <Input inputMode="numeric" autoComplete="off" placeholder="Somente números" value={doc} onChange={(e) => setDoc(e.target.value)} required />
          </label>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <Button type="submit" disabled={busy || !plans.length} className="h-11 w-full">{busy ? "Abrindo pagamento…" : "Ir para o pagamento"}</Button>
          <p className="text-center text-xs text-muted-foreground">Pix, boleto ou cartão, em ambiente seguro. A renovação é mensal e você pode cancelar quando quiser.</p>
        </form>
      )}

      <div className="flex justify-center gap-4 text-sm text-muted-foreground">
        {b.usable && <Link href="/" className="underline">Voltar ao painel</Link>}
        <button onClick={signOut} className="underline">Sair</button>
      </div>
    </main>
  )
}
