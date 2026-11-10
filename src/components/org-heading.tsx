import type { Org } from "@/hooks/use-org"

/** Logotipo (se houver) e nome do grupo, no topo de login/cadastro. */
export function OrgHeading({ org, subtitle }: { org: Pick<Org, "name" | "logo_url" | "tagline"> | null; subtitle: string }) {
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
