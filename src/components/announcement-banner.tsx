"use client"

import { supabase } from "@/lib/supabase/client"
import { Megaphone, X } from "lucide-react"
import * as React from "react"

type A = { id: string; subject: string; body: string; image_url: string | null }

/** Comunicado do dono da plataforma no painel do grupo (administrador e diretoria). Cada pessoa pode dispensar o seu. */
export function AnnouncementBanner() {
  const [list, setList] = React.useState<A[]>([])
  React.useEffect(() => { supabase().rpc("my_announcements").then((r) => setList(Array.isArray(r.data) ? (r.data as A[]) : []), () => {}) }, [])
  if (!list.length) return null
  const a = list[0]
  async function dismiss() { setList((l) => l.filter((x) => x.id !== a.id)); await supabase().rpc("dismiss_announcement", { p_id: a.id }) }
  return (
    <section role="note" aria-label="Comunicado" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
      <div className="flex items-start gap-3">
        <Megaphone className="mt-0.5 size-5 shrink-0 text-blue-700" aria-hidden />
        <div className="min-w-0 flex-1"><p className="font-semibold">{a.subject}</p><p className="mt-1 whitespace-pre-wrap break-words">{a.body}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {a.image_url && <img src={a.image_url} alt="" loading="lazy" className="mt-3 max-h-64 w-full rounded-lg object-cover" />}</div>
        <button type="button" onClick={dismiss} aria-label="Dispensar comunicado" className="grid size-10 shrink-0 place-items-center rounded-lg text-blue-800 hover:bg-blue-100"><X className="size-4" /></button>
      </div>
    </section>
  )
}
