"use client"

import { cn } from "@/lib/utils"
import * as React from "react"

/** Aparece suavemente ao rolar. Sem JavaScript (ou com movimento reduzido) o conteúdo já nasce visível. */
export function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = React.useState(false)
  React.useEffect(() => {
    const el = ref.current
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return
    setHidden(true)
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setHidden(false); io.disconnect() } }, { threshold: 0.12 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={cn("transition-all duration-700 ease-out", hidden && "translate-y-6 opacity-0", className)}>{children}</div>
  )
}
