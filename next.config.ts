import type { NextConfig } from "next";

// Identificador único da versão publicada (definido no build do Docker).
const BUILD_ID = process.env.BUILD_ID || "dev";

const nextConfig: NextConfig = {
  output: "standalone", // imagem Docker enxuta
  generateBuildId: async () => BUILD_ID,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
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
