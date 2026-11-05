"use client"

import { useEffect, useRef, useState } from "react"

const MINE = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"
const CADA = 5 * 60 * 1000

// Há algo sendo digitado? Então não recarrega sozinho (evita perder formulário).
function editando() {
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  return !!document.querySelector("[role=dialog], [data-slot=dialog-content]")
}

// Compara a versão do servidor com a do navegador e atualiza quando muda.
// Não mexe em localStorage/cookies: a sessão do Supabase continua intacta.
export function AutoUpdate() {
  const [nova, setNova] = useState(false)
  const busy = useRef(false)

  useEffect(() => {
    if (MINE === "dev") return
    // Trava anti-laço: no máximo um recarregamento automático por minuto
    // (ex.: durante a troca de contêiner, quando duas versões respondem alternadamente).
    const recarregar = () => {
      try {
        const ult = Number(sessionStorage.getItem("geab.autoReload") ?? 0)
        if (Date.now() - ult < 60_000) return
        sessionStorage.setItem("geab.autoReload", String(Date.now()))
      } catch {}
      window.location.reload()
    }

    async function checar() {
      if (busy.current || document.visibilityState === "hidden") return
      busy.current = true
      try {
        const r = await fetch(`/api/versao?t=${Date.now()}`, { cache: "no-store" })
        if (!r.ok) return
        const { v } = (await r.json()) as { v: string }
        if (v && v !== MINE) {
          if (editando()) setNova(true)
          else recarregar()
        }
      } catch {
        /* sem rede: tenta no próximo ciclo */
      } finally {
        busy.current = false
      }
    }

    const t = setInterval(checar, CADA)
    const onVis = () => document.visibilityState === "visible" && checar()
    document.addEventListener("visibilitychange", onVis)
    checar()
    return () => {
      clearInterval(t)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [])

  // Erro ao carregar um arquivo antigo (deploy trocou os hashes): atualiza uma vez.
  useEffect(() => {
    const onErr = (e: ErrorEvent | PromiseRejectionEvent) => {
      const msg = String((e as ErrorEvent).message ?? (e as PromiseRejectionEvent).reason?.message ?? "")
      if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported/i.test(msg)) {
        if (sessionStorage.getItem("geab.chunkReload") !== MINE) {
          sessionStorage.setItem("geab.chunkReload", MINE)
          window.location.reload()
        }
      }
    }
    window.addEventListener("error", onErr)
    window.addEventListener("unhandledrejection", onErr)
    return () => {
      window.removeEventListener("error", onErr)
      window.removeEventListener("unhandledrejection", onErr)
    }
  }, [])

  if (!nova) return null
  return (
    <div className="fixed inset-x-0 bottom-3 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-lg border bg-background px-4 py-2 text-sm shadow-lg">
      <span>Nova versão disponível.</span>
      <button type="button" className="rounded-md bg-primary px-3 py-1 text-primary-foreground" onClick={() => window.location.reload()}>
        Atualizar
      </button>
    </div>
  )
}
