import { Toaster } from "@/components/ui/sonner"
import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import { AutoUpdate } from "@/components/auto-update"
import "./globals.css"

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" })

export const metadata: Metadata = {
  title: "GEAB Futebol · Financeiro",
  description: "Controle de mensalidades e caixa do GEAB Futebol",
}

export const viewport: Viewport = { themeColor: "#1E3A5F" }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="antialiased">
        {children}
        <AutoUpdate />
        <Toaster richColors position="top-center" />
      </body>
    </html>
  )
}
