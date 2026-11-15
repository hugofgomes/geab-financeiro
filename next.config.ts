import type { NextConfig } from "next";

// Identificador único da versão publicada (definido no build do Docker).
const BUILD_ID = process.env.BUILD_ID || "dev";

const nextConfig: NextConfig = {
  output: "standalone", // imagem Docker enxuta
  generateBuildId: async () => BUILD_ID,
  // Build econômico (VPS pequena): um processo por vez e menos memória no webpack
  experimental: { cpus: 1, webpackMemoryOptimizations: true },
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // /favicon.ico (buscado sozinho por navegadores e robôs): arquivo da marca da instalação (NEXT_PUBLIC_BRAND=partidou).
  async redirects() {
    return [{ source: "/favicon.ico", destination: process.env.NEXT_PUBLIC_BRAND === "partidou" ? "/brand/favicon.ico" : "/brand/geab-favicon.ico", permanent: false }];
  },
  async headers() {
    return [
      // Arquivos com hash no nome: cache longo (já é o padrão do Next, explícito aqui).
      { source: "/_next/static/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      // Páginas e endpoint de versão nunca ficam presos em cache.
      { source: "/api/versao", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
    ];
  },
};

export default nextConfig;
