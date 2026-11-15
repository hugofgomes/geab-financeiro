import { SiteChrome } from "@/components/site/chrome"
import { Sora } from "next/font/google"
import pkg from "../../../package.json"

const sora = Sora({ variable: "--font-sora", subsets: ["latin"], display: "swap" })

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <div className={sora.variable}><SiteChrome version={pkg.version}>{children}</SiteChrome></div>
}
