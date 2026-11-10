/** Grupo (organização) a partir do endereço: slug.dominio-base. Sem NEXT_PUBLIC_BASE_DOMAIN ou fora do padrão: nenhum slug. */
export function slugFromHost(host: string, base = process.env.NEXT_PUBLIC_BASE_DOMAIN) {
  const h = host.toLowerCase().split(":")[0]
  const b = (base ?? "").toLowerCase().replace(/^\./, "")
  if (!b || h === b || !h.endsWith("." + b)) return null
  const sub = h.slice(0, -(b.length + 1))
  return /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(sub) && sub !== "www" ? sub : null
}

export const clientSlug = () => (typeof window === "undefined" ? null : slugFromHost(window.location.host))

/** "Futsal dos Amigos!" → "futsal-dos-amigos" (sem acento, minúsculo, hífens). */
export function slugify(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "")
}

/** Endereço público do grupo, quando a plataforma tem domínio-base configurado. */
export function orgAddress(slug: string, base = process.env.NEXT_PUBLIC_BASE_DOMAIN) {
  return base ? `${slug}.${base.replace(/^\./, "")}` : null
}
