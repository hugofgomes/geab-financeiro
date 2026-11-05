import { Toaster } from "@/components/ui/sonner"
import type { Metadata } from "next"
import { Geist } from "next/font/google"
import { AutoUpdate } from "@/components/auto-update"
import "./globals.css"

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "GEAB Futebol · Financeiro",
  description: "Controle de mensalidades e caixa do GEAB Futebol",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={geist.variable}>
      <body className="antialiased">
        {children}
        <AutoUpdate />
        <Toaster richColors position="top-center" />
      </body>
    </html>
  )
}
