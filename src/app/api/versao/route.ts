export const dynamic = "force-dynamic"

// Versão atualmente publicada no servidor. Público e sem dados sensíveis.
export function GET() {
  return Response.json(
    { v: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  )
}
