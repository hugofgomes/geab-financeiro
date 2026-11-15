import { AthleteShowcase } from "@/components/site/athlete-showcase"
import { BTN_GHOST, BTN_PRIMARY, HEAD, Pitch, SectionHead, Tick } from "@/components/site/dark"
import { DashboardScreen, Float, FinanceScreen, Laptop, LineupCardPhone, LineupScreen, Phone } from "@/components/site/mockups"
import { Reveal } from "@/components/site/reveal"
import { createClient } from "@supabase/supabase-js"
import { ArrowRight, CalendarDays, CircleDollarSign, QrCode, Shirt, Smartphone, Trophy, Users, Wallet } from "lucide-react"
import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

const SITE = "https://geab.vendadigital.com"
const TITLE = "Sistema para grupo de futebol: atletas, jogos, escalação e mensalidades | GEAB Futebol"
const DESC = "Gestão de futebol amador completa: cadastro de atletas, organização de jogos, escalação de times com card para WhatsApp, controle de mensalidades e artilharia. Teste grátis por 10 dias."

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESC,
  keywords: ["sistema para grupo de futebol", "gestão de futebol amador", "aplicativo para organizar futebol", "controle de mensalidades de futebol", "sistema de escalação de times", "gestão de times de futebol society"],
  alternates: { canonical: "/site" },
  openGraph: { title: "GEAB Futebol · Seu futebol merece jogar na primeira divisão", description: DESC, url: "/site", siteName: "GEAB Futebol", type: "website", locale: "pt_BR", images: [{ url: "/site/og.jpg", width: 1200, height: 630, alt: "Estádio de futebol iluminado à noite" }] },
  twitter: { card: "summary_large_image", title: "GEAB Futebol · Gestão do seu grupo de futebol", description: DESC, images: ["/site/og.jpg"] },
}

type Plan = { code: string; name: string; price_cents: number; max_athletes: number | null; max_admins: number | null; trial_days: number; modules: string[] }
const MODULE_LABEL: Record<string, string> = { importar: "Importação de planilhas", ao_vivo: "Gols ao vivo", pix: "Pix automático", mensagens: "WhatsApp e e-mail" }
const ALL_MODULES = Object.keys(MODULE_LABEL)
// Reserva para quando o banco não responde (nome, preço e limites oficiais ficam no painel do SaaS).
const FALLBACK: Plan[] = [
  { code: "teste", name: "Teste gratuito", price_cents: 0, max_athletes: 30, max_admins: null, trial_days: 10, modules: ALL_MODULES },
  { code: "basico", name: "Básico", price_cents: 9900, max_athletes: 60, max_admins: null, trial_days: 10, modules: ALL_MODULES },
  { code: "pro", name: "Profissional", price_cents: 15000, max_athletes: 200, max_admins: null, trial_days: 10, modules: ALL_MODULES },
]
export const revalidate = 300   // o site acompanha a tela de planos do painel, com até 5 minutos de atraso

/** Planos vendidos e teste grátis, direto do banco (função pública public_plans). */
async function loadPlans(): Promise<Plan[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return FALLBACK
  try {
    const { data, error } = await createClient(url, key, { auth: { persistSession: false } }).rpc("public_plans")
    return !error && Array.isArray(data) && data.length ? (data as Plan[]) : FALLBACK
  } catch { return FALLBACK }
}
const INCLUDED = ["Cadastro de atletas", "Mensalidades e caixa", "Jogos e escalações", "Gols e artilharia", "Card para WhatsApp", "Três níveis de acesso"]
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 })


const FEATURES = [
  { icon: Users, title: "Gestão de atletas", text: "Cadastre jogadores, acompanhe informações e mantenha seu elenco organizado." },
  { icon: CalendarDays, title: "Organização de jogos", text: "Crie partidas, registre resultados e acompanhe o calendário do grupo." },
  { icon: Shirt, title: "Escalações automáticas", text: "Monte equipes e compartilhe cards profissionais pelo WhatsApp." },
  { icon: Wallet, title: "Controle financeiro", text: "Gerencie mensalidades, pagamentos, pendências e o caixa do grupo." },
  { icon: Trophy, title: "Gols e artilharia", text: "Registre gols, acompanhe resultados e veja os destaques da temporada." },
  { icon: Smartphone, title: "Área exclusiva do atleta", text: "Cada jogador acompanha seus jogos, pagamentos e desempenho pelo celular." },
]

const PHONES = [
  { src: "/site/celular-painel.png", w: 660, h: 1240, framed: false, title: "Dashboard do grupo", alt: "Dashboard do grupo no celular: atletas ativos, recebimentos e próximo jogo (dados ilustrativos)" },
  { src: "/site/celular-jogos.png", w: 650, h: 1238, framed: false, title: "Calendário e jogos", alt: "Calendário de jogos e escalação no celular (dados ilustrativos)" },
  { src: "/site/atleta-celular.webp", w: 900, h: 1600, framed: true, title: "Área do atleta", alt: "Área do atleta no celular: próximo jogo e mensalidade (dados ilustrativos)" },
]

export default async function SitePage() {
  const plans = await loadPlans()
  const paid = plans.filter((p) => p.price_cents > 0)
  const hot = paid.length ? paid[0].code : null
  const trial = plans.find((p) => p.code === "teste")?.trial_days ?? 10
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: "GEAB Futebol", url: SITE, logo: `${SITE}/icon.png` },
      { "@type": "SoftwareApplication", name: "GEAB Futebol", applicationCategory: "SportsApplication", operatingSystem: "Web, Android, iOS (PWA)", description: DESC, url: `${SITE}/site`,
        inLanguage: "pt-BR", offers: plans.map((p) => ({ "@type": "Offer", name: p.name, price: (p.price_cents / 100).toFixed(2), priceCurrency: "BRL", url: `${SITE}/novo-grupo` })) },
    ],
  }
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />

      {/* HERO */}
      <section id="inicio" aria-labelledby="hero-t" className="relative isolate overflow-hidden pt-28 pb-20 sm:pt-32 lg:pb-28">
        <Image src="/site/estadio.webp" alt="" fill priority sizes="100vw" quality={70} className="-z-30 object-cover object-center" />
        <div aria-hidden className="absolute inset-0 -z-20 bg-gradient-to-b from-[#080D0B]/55 via-[#080D0B]/40 to-[#080D0B]" />
        <div aria-hidden className="absolute inset-0 -z-20 bg-[radial-gradient(60%_50%_at_50%_100%,rgba(57,255,20,.16),transparent)]" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70%] overflow-hidden">
          <div className="site-beam absolute -top-10 left-[8%] h-[120%] w-40 bg-gradient-to-b from-white/25 to-transparent blur-2xl" style={{ clipPath: "polygon(40% 0, 60% 0, 100% 100%, 0 100%)" }} />
          <div className="site-beam absolute -top-10 right-[8%] h-[120%] w-40 bg-gradient-to-b from-white/25 to-transparent blur-2xl [animation-delay:-3s]" style={{ clipPath: "polygon(40% 0, 60% 0, 100% 100%, 0 100%)" }} />
        </div>

        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 lg:grid-cols-[1fr_1.05fr]">
          <div className="site-rise">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#39FF14]/30 bg-[#39FF14]/10 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-[#39FF14]"><span aria-hidden className="site-pulse size-1.5 rounded-full bg-[#39FF14]" /> {trial} DIAS GRÁTIS, SEM CARTÃO</p>
            <h1 id="hero-t" className={`${HEAD} text-balance text-4xl font-extrabold tracking-tight text-white uppercase sm:text-5xl lg:text-[3.4rem] lg:leading-[1.04]`}>
              Seu futebol merece jogar na <span className="text-[#39FF14]">primeira divisão.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/80">Gerencie atletas, organize partidas, monte escalações, controle mensalidades e acompanhe estatísticas. Tudo em uma única plataforma.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/novo-grupo" className={BTN_PRIMARY}>COMEÇAR {trial} DIAS GRÁTIS <ArrowRight className="size-4" /></Link>
              <Link href="/demo" className={BTN_GHOST}>CONHECER O SISTEMA</Link>
            </div>
          </div>
          <div className="site-rise relative px-2 pb-10 [animation-delay:.15s] sm:px-8">
            <div aria-hidden className="absolute inset-x-[10%] -top-6 bottom-0 -z-10 rounded-full bg-[#39FF14]/10 blur-3xl" />
            <Laptop label="Painel do GEAB Futebol no computador (dados ilustrativos)"><DashboardScreen /></Laptop>
            <Phone label="Escalação em card para WhatsApp no celular (dados ilustrativos)" className="absolute -right-0 -bottom-2 w-[26%] min-w-24 sm:-right-2"><LineupCardPhone /></Phone>
            <Float icon={Users} title="Atletas ativos" value="24" className="-top-3 right-6 sm:right-16" />
            <Float icon={CircleDollarSign} title="Mensalidades recebidas" value="R$ 1.870" className="bottom-6 left-0 hidden sm:flex" delay={1.5} />
          </div>
        </div>
        <p className="mx-auto mt-6 max-w-7xl px-5 text-xs text-white/40">Imagens ilustrativas: nomes e valores são fictícios.</p>
      </section>

      {/* FUNCIONALIDADES */}
      <section id="funcionalidades" aria-labelledby="func-t" className="scroll-mt-16 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-5">
          <Reveal><SectionHead eyebrow="Tudo que seu grupo precisa" title="Menos planilhas. Mais futebol." text="Chega de perder tempo organizando jogos, cobrando mensalidades e montando times manualmente." center /></Reveal>
          <span id="func-t" className="sr-only">Funcionalidades</span>
          <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 70}>
                <li className="group h-full rounded-2xl border border-white/10 bg-white/[.03] p-7 transition duration-300 hover:-translate-y-1 hover:border-[#39FF14]/40 hover:bg-white/[.06] hover:shadow-[0_20px_60px_-30px_rgba(57,255,20,.45)]">
                  <span aria-hidden className="grid size-12 place-items-center rounded-xl bg-[#39FF14]/10 text-[#39FF14] transition group-hover:bg-[#39FF14]/20"><f.icon className="size-6" /></span>
                  <h3 className={`${HEAD} mt-5 text-lg font-bold text-white`}>{f.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#AAB4AE]">{f.text}</p>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* ESCALAÇÃO */}
      <section id="jogos" aria-labelledby="jogos-t" className="scroll-mt-16 bg-gradient-to-b from-transparent via-[#063B26]/25 to-transparent py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 lg:grid-cols-[.9fr_1.1fr]">
          <Reveal>
            <SectionHead eyebrow="Jogos e escalação" title="Monte seus times como um treinador profissional." />
            <span id="jogos-t" className="sr-only">Jogos e escalação</span>
            <ul className="mt-8 space-y-3.5">
              <Tick>Montagem de equipes com os atletas ativos do grupo</Tick>
              <Tick>Distribuição automática entre as equipes, com ajuste manual</Tick>
              <Tick>Escalação confirmada fica protegida contra alterações acidentais</Tick>
              <Tick>Cards prontos para compartilhar no WhatsApp</Tick>
              <Tick>Agenda de jogos com resultados e artilharia</Tick>
            </ul>
            <div className="mt-9"><Link href="/demo" className={BTN_PRIMARY}>VER COMO FUNCIONA <ArrowRight className="size-4" /></Link></div>
          </Reveal>
          <Reveal delay={150}>
            <div className="relative pb-10 sm:pb-16">
              <div className="aspect-[10/7] overflow-hidden rounded-3xl border border-white/10 shadow-[0_30px_80px_-30px_rgba(0,0,0,.8)]"><Pitch /></div>
              <div className="mt-5 sm:absolute sm:-right-3 sm:-bottom-4 sm:mt-0 sm:w-[58%]">
                <Laptop label="Tela de escalação do sistema (dados ilustrativos)"><LineupScreen /></Laptop>
              </div>
              <Phone label="Card de escalação para WhatsApp (dados ilustrativos)" className="absolute -bottom-0 left-2 hidden w-[22%] min-w-24 sm:block"><LineupCardPhone /></Phone>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FINANCEIRO */}
      <section id="financeiro" aria-labelledby="fin-t" className="scroll-mt-16 py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 lg:grid-cols-[1.1fr_.9fr]">
          <Reveal className="order-2 lg:order-1">
            <div className="relative px-2 py-8 sm:px-8">
              <div aria-hidden className="absolute inset-x-[10%] top-6 bottom-6 -z-10 rounded-full bg-[#39FF14]/10 blur-3xl" />
              <Laptop label="Tela de mensalidades do sistema (dados ilustrativos)"><FinanceScreen /></Laptop>
              <Float icon={CircleDollarSign} title="Total recebido" value="R$ 1.270" className="top-0 right-0 sm:-right-2" />
              <Float icon={Wallet} title="Pendentes" value="R$ 410" className="bottom-2 left-0 sm:-left-2" delay={1.5} />
            </div>
          </Reveal>
          <Reveal delay={120} className="order-1 lg:order-2">
            <SectionHead eyebrow="Financeiro" title="O financeiro do seu grupo sempre em dia." />
            <span id="fin-t" className="sr-only">Financeiro</span>
            <ul className="mt-8 space-y-3.5">
              <Tick>Mensalidades por mês, com situação de cada atleta</Tick>
              <Tick>Registro de pagamentos e histórico completo</Tick>
              <Tick>Pix com QR Code e copia e cola no valor exato da mensalidade</Tick>
              <Tick>Caixa e extrato com receitas, despesas e saldo</Tick>
              <Tick>Cada atleta vê a própria mensalidade e paga pelo celular</Tick>
            </ul>
            <p className="mt-5 flex items-center gap-2 text-sm text-white/50"><QrCode className="size-4" aria-hidden /> Valores de exemplo, apenas ilustrativos.</p>
          </Reveal>
        </div>
      </section>

      {/* ÁREA DO ATLETA */}
      <section id="atleta" aria-labelledby="atl-t" className="scroll-mt-16 bg-gradient-to-b from-transparent via-[#063B26]/25 to-transparent py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 lg:grid-cols-[.85fr_1.15fr]">
          <Reveal>
            <SectionHead eyebrow="Área do atleta" title="Uma central para cada atleta." text="Cada jogador entra com o próprio acesso e acompanha tudo o que é dele." />
            <span id="atl-t" className="sr-only">Área do atleta</span>
            <ul className="mt-8 space-y-3.5">
              <Tick>Próximo jogo e escalação do grupo</Tick><Tick>Mensalidade do mês com pagamento por Pix</Tick>
              <Tick>Desempenho: gols, jogos e posição na artilharia</Tick><Tick>Histórico de jogos e de pagamentos</Tick>
            </ul>
          </Reveal>
          <Reveal delay={150}><AthleteShowcase dark /></Reveal>
        </div>
      </section>

      {/* MOBILE */}
      <section aria-labelledby="mob-t" className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-5">
          <Reveal><SectionHead eyebrow="Experiência mobile" title="Seu grupo na palma da mão." text="Acesse pelo navegador do celular, sem instalação obrigatória. Se preferir, instale como aplicativo na tela inicial." center /></Reveal>
          <span id="mob-t" className="sr-only">Experiência mobile</span>
          <div className="mt-14 grid grid-cols-3 items-end gap-3 sm:gap-8">
            {PHONES.map((ph, i) => (
              <Reveal key={ph.src} delay={i * 120} className={i === 1 ? "sm:-translate-y-6" : ""}>
                <figure>
                  {ph.framed
                    ? <Phone label={ph.alt}><Image src={ph.src} alt={ph.alt} width={ph.w} height={ph.h} sizes="(min-width: 640px) 300px, 33vw" loading="lazy" className="h-full w-full object-cover object-top" /></Phone>
                    : <Image src={ph.src} alt={ph.alt} width={ph.w} height={ph.h} sizes="(min-width: 640px) 300px, 33vw" loading="lazy" className="h-auto w-full drop-shadow-[0_30px_40px_rgba(0,0,0,.6)]" />}
                  <figcaption className="mt-4 text-center text-xs font-medium text-white/80 sm:text-sm">{ph.title}</figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
          <p className="mt-8 text-center text-xs text-white/40">Imagens ilustrativas: nomes e valores são fictícios.</p>
        </div>
      </section>

      {/* PLANOS */}
      <section id="planos" aria-labelledby="planos-t" className="scroll-mt-16 bg-gradient-to-b from-transparent via-[#063B26]/25 to-transparent py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-5">
          <Reveal><SectionHead eyebrow="Planos e preços" title="Um plano para o tamanho do seu grupo." text="Comece grátis e evolua quando precisar. O que cada plano inclui está listado abaixo." center /></Reveal>
          <span id="planos-t" className="sr-only">Planos e preços</span>
          <div className={`mt-14 grid gap-6 ${plans.length >= 4 ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3"}`}>
            {plans.map((p, i) => {
              const pop = p.code === hot
              return (
                <Reveal key={p.code} delay={i * 100}>
                  <div className={`relative flex h-full flex-col rounded-3xl border p-8 transition duration-300 hover:-translate-y-1 ${pop ? "border-[#39FF14]/60 bg-gradient-to-b from-[#39FF14]/10 to-white/[.03] shadow-[0_24px_70px_-30px_rgba(57,255,20,.5)]" : "border-white/10 bg-white/[.03] hover:border-white/25"}`}>
                    {pop && <span className="absolute -top-3 left-8 rounded-full bg-[#39FF14] px-3 py-1 text-xs font-bold tracking-wide text-[#04130B]">POPULAR</span>}
                    <h3 className={`${HEAD} text-lg font-bold text-white`}>{p.name}</h3>
                    <p className="mt-5"><span className={`${HEAD} text-4xl font-extrabold text-white`}>{p.price_cents ? brl(p.price_cents) : "Grátis"}</span> <span className="text-sm text-[#AAB4AE]">{p.price_cents ? "por mês" : `por ${p.trial_days} dias`}</span></p>
                    <p className="mt-1 text-sm font-medium text-[#39FF14]">{p.max_athletes ? `Até ${p.max_athletes} jogadores` : "Jogadores ilimitados"} · {p.max_admins ? `${p.max_admins} ${p.max_admins === 1 ? "administrador" : "administradores"}` : "administradores ilimitados"}</p>
                    <ul className="mt-6 flex-1 space-y-3">
                      {INCLUDED.map((x) => <Tick key={x}>{x}</Tick>)}
                      {ALL_MODULES.map((m) => <Tick key={m} off={!p.modules.includes(m)}>{MODULE_LABEL[m]}</Tick>)}
                    </ul>
                    <Link href="/novo-grupo" className={`mt-8 ${pop ? BTN_PRIMARY : BTN_GHOST} w-full`}>{p.price_cents ? `COMEÇAR COM O ${p.name.toUpperCase()}` : `TESTAR ${p.trial_days} DIAS GRÁTIS`}</Link>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* CONVERSÃO FINAL */}
      <section aria-labelledby="final-t" className="relative isolate overflow-hidden py-24 sm:py-32">
        <Image src="/site/estadio.webp" alt="" fill loading="lazy" sizes="100vw" quality={60} className="-z-30 scale-110 object-cover object-top" />
        <div aria-hidden className="absolute inset-0 -z-20 bg-gradient-to-b from-[#080D0B] via-[#080D0B]/70 to-[#080D0B]" />
        <div aria-hidden className="absolute inset-0 -z-20 bg-[radial-gradient(50%_60%_at_50%_100%,rgba(57,255,20,.22),transparent)]" />
        <Reveal className="mx-auto max-w-3xl px-5 text-center">
          <h2 id="final-t" className={`${HEAD} text-balance text-3xl font-extrabold tracking-tight text-white uppercase sm:text-5xl sm:leading-[1.08]`}>O próximo craque do seu grupo é a <span className="text-[#39FF14]">organização.</span></h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-white/80">Transforme a gestão do seu futebol com uma plataforma criada para quem vive a paixão pelo esporte.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/novo-grupo" className={BTN_PRIMARY}>COMEÇAR MEU TESTE GRÁTIS <ArrowRight className="size-4" /></Link>
            <Link href="/demo" className={BTN_GHOST}>EXPLORAR DEMONSTRAÇÃO</Link>
          </div>
          <p className="mt-8 text-sm text-white/60"><Link href="/site" className="underline decoration-white/30 underline-offset-4 hover:text-[#39FF14]">https://geab.vendadigital.com/</Link></p>
        </Reveal>
      </section>
    </>
  )
}
