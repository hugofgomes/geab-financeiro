import type { Org } from "@/hooks/use-org"
import { IS_PARTIDOU } from "@/lib/brand"

/** Logotipo (se houver) e nome do grupo, no topo de login/cadastro. */
export function OrgHeading({ org, subtitle }: { org: Pick<Org, "name" | "logo_url" | "tagline"> | null; subtitle: string }) {
  if (IS_PARTIDOU) {
    // Partidou: logotipo oficial sobre faixa verde-escura (o logo é para fundo escuro) e a ação da tela.
    return (
      <div className="text-center">
        <div className="mx-auto mb-3 rounded-2xl bg-primary px-5 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/partidou-logo.png" alt="Partidou" className="mx-auto h-14 w-auto max-w-full object-contain" />
        </div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    )
  }
  return (
    <div className="text-center">
      {org?.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={org.logo_url} alt="" className="mx-auto mb-2 h-14 w-auto max-w-40 object-contain" />
      )}
      <h1 className="text-xl font-bold tracking-wide uppercase">{org?.name ?? "\u00a0"}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}
