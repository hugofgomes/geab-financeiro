import { Toaster } from "@/components/ui/sonner"
import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import { AutoUpdate } from "@/components/auto-update"
import { PwaRegister } from "@/components/pwa"
import { BRAND_NAME, BRAND_PRIMARY, IS_PARTIDOU } from "@/lib/brand"
import "./globals.css"

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" })

export const metadata: Metadata = {
  title: IS_PARTIDOU ? "Partidou · Gestão de quadras" : "GEAB Futebol · Financeiro",
  description: IS_PARTIDOU ? "Gestão profissional de quadras esportivas e conexão de jogadores. O jogo começa aqui." : "Controle de mensalidades e caixa do GEAB Futebol",
  applicationName: BRAND_NAME,
  appleWebApp: { capable: true, title: IS_PARTIDOU ? "Partidou" : "GEAB", statusBarStyle: "default" },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = { themeColor: BRAND_PRIMARY, viewportFit: "cover" }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${inter.variable}${IS_PARTIDOU ? " brand-partidou" : ""}`}>
      <body className="antialiased">
        {children}
        <AutoUpdate />
        <PwaRegister />
        <Toaster richColors position="top-center" />
      </body>
    </html>
  )
}
