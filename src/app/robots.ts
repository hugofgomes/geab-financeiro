import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/site", "/demo", "/novo-grupo", "/privacidade", "/termos"], disallow: ["/api/", "/super", "/atleta", "/assinatura", "/login"] }],
    sitemap: "https://geab.vendadigital.com/sitemap.xml",
  }
}
