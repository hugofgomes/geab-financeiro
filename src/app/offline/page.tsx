"use client"

import { WifiOff } from "lucide-react"

/** Mostrada pelo app instalável quando não há conexão. Pública e sem dados. */
export default function OfflinePage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-primary p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-card p-6 text-center shadow-xl">
        <WifiOff className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">Sem conexão</h1>
        <p className="text-sm text-muted-foreground">Não foi possível falar com o servidor. Confira a internet do aparelho e tente de novo.</p>
        <button type="button" onClick={() => window.location.reload()} className="h-11 w-full rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Tentar novamente</button>
      </div>
    </div>
  )
}
