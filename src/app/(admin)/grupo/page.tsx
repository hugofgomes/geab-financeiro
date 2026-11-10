"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ORG_CHANGED, useOrg } from "@/hooks/use-org"
import { supabase } from "@/lib/supabase/client"
import { orgAddress } from "@/lib/tenant"
import { Loader2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

const STATUS: Record<string, string> = { teste: "Em teste", ativa: "Ativa", suspensa: "Suspensa", cancelada: "Cancelada" }

/** Identidade do grupo: nome, logotipo (endereço https), cor, site e lema. Aparecem no painel, no login e no card da escalação. */
export default function GroupPage() {
  const org = useOrg()
  const [f, setF] = React.useState({ name: "", logo: "", color: "", website: "", tagline: "" })
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (org) setF({ name: org.name, logo: org.logo_url ?? "", color: org.primary_color ?? "", website: org.website ?? "", tagline: org.tagline ?? "" })
  }, [org])
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase().rpc("update_organization", { p_name: f.name, p_logo_url: f.logo, p_primary_color: f.color, p_website: f.website, p_tagline: f.tagline })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Dados do grupo salvos.")
    window.dispatchEvent(new Event(ORG_CHANGED))
  }

  if (!org) return <Skeleton className="h-60" />
  const addr = orgAddress(org.slug)
  const days = org.status === "teste" && org.trial_ends_at ? Math.ceil((new Date(org.trial_ends_at).getTime() - Date.now()) / 86_400_000) : null
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Meu grupo</h1>
      <p className="text-sm text-muted-foreground">
        Situação: <b>{STATUS[org.status] ?? org.status}</b>
        {days != null && <> · {days > 0 ? `${days} dia(s) de teste restantes` : "teste encerrado"}</>}
        {addr && <> · Endereço: <b>{addr}</b></>}
      </p>
      <Card><CardContent className="pt-4">
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="gn">Nome do grupo</Label><Input id="gn" required maxLength={80} value={f.name} onChange={set("name")} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="gl">Logotipo <span className="font-normal text-muted-foreground">(endereço da imagem, começando com https://)</span></Label>
            <Input id="gl" type="url" maxLength={255} placeholder="https://…/logo.png" value={f.logo} onChange={set("logo")} /></div>
          <div className="space-y-1.5"><Label htmlFor="gc">Cor principal <span className="font-normal text-muted-foreground">(ex.: #0057B8)</span></Label>
            <Input id="gc" maxLength={7} placeholder="#0057B8" value={f.color} onChange={set("color")} /></div>
          <div className="space-y-1.5"><Label htmlFor="gw">Site</Label><Input id="gw" maxLength={120} placeholder="seugrupo.com.br" value={f.website} onChange={set("website")} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="gt">Lema <span className="font-normal text-muted-foreground">(aparece no card da escalação)</span></Label>
            <Input id="gt" maxLength={80} placeholder="Tradição, amizade e futebol" value={f.tagline} onChange={set("tagline")} /></div>
          <div className="sm:col-span-2"><Button type="submit" variant="brand" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar</Button></div>
        </form>
      </CardContent></Card>
    </>
  )
}
