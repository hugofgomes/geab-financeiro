import { BRAND_PRIMARY, IS_PARTIDOU } from "@/lib/brand"
import type { MetadataRoute } from "next"

/** App instalável (PWA): aparece como "Instalar app" no Android/Chrome e "Adicionar à Tela de Início" no iPhone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: IS_PARTIDOU ? "Partidou · Gestão de quadras" : "GEAB Futebol · Gestão do grupo",
    short_name: IS_PARTIDOU ? "Partidou" : "GEAB",
    description: IS_PARTIDOU ? "Agenda, reservas e financeiro do seu centro esportivo." : "Atletas, mensalidades, jogos e escalações do seu grupo de futebol.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: BRAND_PRIMARY,
    theme_color: BRAND_PRIMARY,
    categories: ["sports", "business", "productivity"],
    icons: IS_PARTIDOU
      ? [
          { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ]
      : [
          { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
    shortcuts: IS_PARTIDOU ? [
      { name: "Agenda", short_name: "Agenda", url: "/quadra/agenda", icons: [{ src: "/brand/icon-192.png", sizes: "192x192" }] },
      { name: "Reservas", short_name: "Reservas", url: "/quadra/reservas", icons: [{ src: "/brand/icon-192.png", sizes: "192x192" }] },
    ] : [
      { name: "Mensalidades", short_name: "Mensalidades", url: "/mensalidades", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Jogos", short_name: "Jogos", url: "/jogos", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Atletas", short_name: "Atletas", url: "/atletas", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
    ],
  }
}
