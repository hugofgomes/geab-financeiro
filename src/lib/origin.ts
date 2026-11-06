/** Endereço público do sistema (atrás do proxy do Coolify o endereço interno não serve). */
export function publicOrigin(req: Request) {
  const h = req.headers
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")
  return `${proto}://${host}`
}
/** Endereço de retorno cadastrado no aplicativo do BTG. */
export const btgRedirectUri = (req: Request) => process.env.BTG_REDIRECT_URI || `${publicOrigin(req)}/api/btg/callback`
