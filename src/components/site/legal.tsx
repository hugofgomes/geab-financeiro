import { HEAD } from "@/components/site/dark"

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-5 pt-28 pb-24">
      <h1 className={`${HEAD} text-3xl font-extrabold tracking-tight text-white uppercase sm:text-4xl`}>{title}</h1>
      <p className="mt-2 text-sm text-white/50">Última atualização: {updated}</p>
      <div className="mt-10 space-y-5 text-[15px] leading-relaxed text-[#AAB4AE] [&_a]:text-[#39FF14] [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-10 [&_h2]:font-[family-name:var(--font-sora)] [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_strong]:text-white">
        {children}
      </div>
    </article>
  )
}
