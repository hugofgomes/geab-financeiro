"use client"

import { cn } from "@/lib/utils"
import * as React from "react"

/** Logo do GEAB (public/logo-geab.png). Se o arquivo faltar, mostra o ⚽ em vez de imagem quebrada. */
export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  const [failed, setFailed] = React.useState(false)
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-full bg-white shadow-sm ring-1 ring-black/5", className)}
      style={{ width: size, height: size }}
    >
      {failed ? (
        <span aria-hidden style={{ fontSize: size * 0.55 }}>⚽</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/logo-geab.png" alt="GEAB Futebol" width={size} height={size} onError={() => setFailed(true)} className="rounded-full object-contain" />
      )}
    </span>
  )
}
