"use client"

import { Download, Share, X } from "lucide-react"
import * as React from "react"

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const KEY = "geab.pwa.dispensado"

/** Registra o service worker (só em produção) e oferece a instalação do app no celular. */
export function PwaRegister() {
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {})
  }, [])
  return null
}

/** Convite discreto para instalar: botão nativo no Android/Chrome; instrução de "Adicionar à Tela de Início" no iPhone. Some depois de instalar ou dispensar. */
export function InstallBanner() {
  const [bip, setBip] = React.useState<BIP | null>(null)
  const [ios, setIos] = React.useState(false)
  const [hidden, setHidden] = React.useState(true)
  React.useEffect(() => {
    let dismissed = false
    try { dismissed = localStorage.getItem(KEY) === "1" } catch {}
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    const mobile = window.matchMedia("(max-width: 1023px)").matches
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)
    setIos(isIos)
    setHidden(dismissed || standalone || !mobile)
    const onPrompt = (e: Event) => { e.preventDefault(); setBip(e as BIP) }
    const onInstalled = () => setHidden(true)
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled) }
  }, [])
  if (hidden || (!bip && !ios)) return null
  const dismiss = () => { try { localStorage.setItem(KEY, "1") } catch {} setHidden(true) }
  async function install() { if (!bip) return; await bip.prompt(); await bip.userChoice.catch(() => {}); setBip(null); setHidden(true) }
  return (
    <div role="note" className="flex items-center gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm lg:hidden">
      {bip ? <Download className="size-5 shrink-0 text-primary" aria-hidden /> : <Share className="size-5 shrink-0 text-primary" aria-hidden />}
      <p className="min-w-0 flex-1">
        <b>Instale o app no celular.</b>{" "}
        {bip ? "Abre em tela cheia, direto da tela inicial." : <>Toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</>}
      </p>
      {bip && <button type="button" onClick={install} className="h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Instalar</button>}
      <button type="button" onClick={dismiss} aria-label="Dispensar" className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"><X className="size-4" /></button>
    </div>
  )
}
