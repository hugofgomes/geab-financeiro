import type { Metadata } from "next"
import { DemoApp } from "./demo-app"

export const metadata: Metadata = {
  title: "Demonstração · GEAB Futebol",
  description: "Navegue por uma versão de demonstração do GEAB Futebol, com dados fictícios.",
  robots: { index: false },
}

export default function DemoPage() { return <DemoApp /> }
