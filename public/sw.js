// Service worker do app instalável (PWA).
// REGRA DE SEGURANÇA: nunca guarda páginas, respostas de API ou dados do Supabase (são de pessoas logadas e podem ser de outro usuário
// no mesmo aparelho). Só guarda arquivos estáticos públicos (ícones e código versionado) e a página offline.
const CACHE = "geab-pwa-v1"
const OFFLINE = "/offline"
const PRECACHE = [OFFLINE, "/pwa/icon-192.png", "/pwa/icon-512.png"]

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener("fetch", (e) => {
  const req = e.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return          // Supabase, Asaas etc.: sempre direto na rede
  if (url.pathname.startsWith("/api/")) return             // APIs: sempre na rede

  // Navegação: rede primeiro; sem conexão, mostra a página offline (nenhuma página é guardada)
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((r) => r ?? Response.error())))
    return
  }
  // Arquivos estáticos versionados e ícones: cache primeiro (o nome do arquivo muda quando o conteúdo muda)
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pwa/")) {
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
      return res
    })))
  }
})
