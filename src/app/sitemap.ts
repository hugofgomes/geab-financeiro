import type { MetadataRoute } from "next"

const BASE = "https://geab.vendadigital.com"

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number][] = [["/site", 1], ["/novo-grupo", 0.8], ["/demo", 0.7], ["/privacidade", 0.3], ["/termos", 0.3]]
  return pages.map(([p, priority]) => ({ url: BASE + p, changeFrequency: "monthly", priority }))
}
