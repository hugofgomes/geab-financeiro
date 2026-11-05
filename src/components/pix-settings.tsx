"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { inspectBrCode } from "@/lib/brcode"
import { supabase } from "@/lib/supabase/client"
import { Loader2, QrCode } from "lucide-react"
import QRCode from "qrcode"
import * as React from "react"
import { toast } from "sonner"

export const PIX_SETTING = "pix_br_code"

/** Diretoria cola o Pix "copia e cola" de recebimento; o portal do atleta passa a mostrar o QR de cada mensalidade. */
export function PixSettings() {
  const [saved, setSaved] = React.useState<string | null>(null)
  const [text, setText] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [qr, setQr] = React.useState("")

  React.useEffect(() => {
    supabase().from("app_settings").select("value").eq("key", PIX_SETTING).maybeSingle().then((r) => {
      const v = (r.data?.value as string | undefined) ?? null
      setSaved(v); setText(v ?? ""); setLoaded(true)
    })
  }, [])
  const info = text.trim() ? inspectBrCode(text) : null
  React.useEffect(() => {
    if (!info) { setQr(""); return }
    QRCode.toDataURL(text.trim(), { margin: 1, width: 180 }).then(setQr, () => setQr(""))
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!info) return toast.error("Este não é um Pix copia e cola válido.")
    setBusy(true)
    const { error } = await supabase().from("app_settings").upsert({ key: PIX_SETTING, value: text.trim(), updated_at: new Date().toISOString() })
    setBusy(false)
    if (error) return toast.error(error.message)
    setSaved(text.trim()); toast.success("Pix de recebimento salvo.")
  }
  async function remove() {
    if (!window.confirm("Remover o Pix de recebimento? Os atletas deixam de ver o QR Code.")) return
    setBusy(true)
    const { error } = await supabase().from("app_settings").delete().eq("key", PIX_SETTING)
    setBusy(false)
    if (error) return toast.error(error.message)
    setSaved(null); setText(""); toast.success("Pix removido.")
  }

  return (
    <details className="group rounded-xl border bg-card shadow-sm" open={loaded && !saved}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-primary"><QrCode className="size-4" /> Pix de recebimento (QR Code do atleta) {saved && <span className="font-normal text-green-700">· configurado</span>}</summary>
      <Card className="rounded-t-none border-0 shadow-none ring-0"><CardContent className="space-y-3 pt-0">
        <p className="text-sm text-muted-foreground">Cole aqui o <b>Pix Copia e Cola</b> da conta que recebe as mensalidades (do app do banco, em “Pix → Receber → Copia e Cola”). O portal do atleta gera, a partir dele, o QR Code com o valor exato de cada mensalidade em aberto.</p>
        <div className="space-y-1.5">
          <Label htmlFor="pixcode">Pix Copia e Cola</Label>
          <textarea id="pixcode" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="00020126…" className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
        </div>
        {text.trim() && !info && <p role="alert" className="text-sm text-destructive">Código inválido: copie o Pix Copia e Cola inteiro, sem espaços extras.</p>}
        {info && (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-background p-3 text-sm">
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="Pré-visualização do QR Code" width={96} height={96} className="size-24 rounded-lg border bg-white p-1" />
            )}
            <dl className="space-y-0.5">
              <div><dt className="inline text-muted-foreground">Chave: </dt><dd className="inline font-medium">{info.key}</dd></div>
              <div><dt className="inline text-muted-foreground">Recebedor: </dt><dd className="inline font-medium">{info.name.trim()}</dd></div>
              <div><dt className="inline text-muted-foreground">Valor no código: </dt><dd className="inline">{info.amount == null ? "em aberto" : `R$ ${info.amount.toFixed(2).replace(".", ",")} (será substituído pelo valor de cada mensalidade)`}</dd></div>
            </dl>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Confira se o <b>recebedor</b> é a conta certa. O Pix estático não avisa o sistema: os pagamentos entram pela tela <i>Extrato</i> (arquivo OFX do banco).</p>
        <div className="flex gap-2">
          <Button onClick={save} disabled={!info || busy || text.trim() === saved}>{busy && <Loader2 className="animate-spin" />} Salvar</Button>
          {saved && <Button variant="outline" onClick={remove} disabled={busy}>Remover</Button>}
        </div>
      </CardContent></Card>
    </details>
  )
}
