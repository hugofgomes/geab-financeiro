"use client"

import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

/** Cartão de feliz aniversário em pop-up. `names` = quem faz aniversário hoje. */
export function BirthdayCard({ names, self, onClose }: { names: string[]; self: boolean; onClose: () => void }) {
  const open = names.length > 0
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-sm overflow-hidden border-0 bg-gradient-to-b from-[#0b3d1e] to-[#14632f] p-0 text-center text-white sm:max-w-sm">
        <div className="relative px-6 pb-6 pt-8">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-2 flex justify-between px-5 text-2xl motion-safe:animate-bounce">
            <span>🎈</span><span>🎉</span><span>🎈</span>
          </div>
          <div className="mt-4 flex items-center justify-center gap-3"><Logo size={56} /><span aria-hidden className="text-6xl">🎂</span></div>
          <DialogTitle className="mt-3 text-2xl font-bold tracking-tight text-white">
            {self ? `Feliz aniversário, ${names[0]}!` : names.length === 1 ? "Aniversário hoje!" : "Aniversariantes de hoje!"}
          </DialogTitle>
          {!self && (
            <ul className="mt-3 space-y-0.5 text-lg font-semibold text-yellow-300">
              {names.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
          <DialogDescription className="mt-3 text-sm leading-relaxed text-green-50/90">
            {self
              ? "O GEAB Futebol deseja muita saúde, alegria e muitos gols neste novo ano de vida. Obrigado por fazer parte da nossa história!"
              : "Que tal mandar um parabéns? Em nome de todo o GEAB, muita saúde, alegria e muitos gols!"}
          </DialogDescription>
          <div aria-hidden className="mt-4 text-2xl">⚽ 🥳 ⚽</div>
          <p className="mt-1 text-xs text-green-100/70">GEAB Futebol · Desde 1998</p>
          <Button onClick={onClose} className="mt-5 bg-yellow-400 text-black hover:bg-yellow-300">
            {self ? "Obrigado!" : "Fechar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
