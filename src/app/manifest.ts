import type { MetadataRoute } from "next"

/** App instalável (PWA): aparece como "Instalar app" no Android/Chrome e "Adicionar à Tela de Início" no iPhone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GEAB Futebol · Gestão do grupo",
    short_name: "GEAB",
    description: "Atletas, mensalidades, jogos e escalações do seu grupo de futebol.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1E3A5F",
    theme_color: "#1E3A5F",
    categories: ["sports", "business", "productivity"],
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Mensalidades", short_name: "Mensalidades", url: "/mensalidades", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Jogos", short_name: "Jogos", url: "/jogos", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Atletas", short_name: "Atletas", url: "/atletas", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
    ],
  }
}
