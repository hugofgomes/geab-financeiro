import { AthleteShowcase } from "@/components/site/athlete-showcase"
import { Benefit, CircleDollarSign, DashboardScreen, Float, FinanceScreen, Laptop, LineupCardPhone, LineupScreen, Phone, Trophy, Users } from "@/components/site/mockups"
import { Reveal } from "@/components/site/reveal"
import { createClient } from "@supabase/supabase-js"
import { ArrowRight } from "lucide-react"
import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

export const metadata: Metadata = {
  title: "GEAB Futebol · Gestão completa do seu grupo de futebol",
  description: "Atletas, partidas, escalações, mensalidades e estatísticas em uma plataforma simples e profissional. Teste a demonstração.",
  openGraph: { title: "GEAB Futebol", description: "Tudo do seu futebol em um só lugar.", type: "website", locale: "pt_BR" },
}

const H2 = "text-balance text-3xl font-bold tracking-tight text-[#17365D] sm:text-4xl lg:text-[2.7rem] lg:leading-[1.1]"
const CTA = "inline-flex items-center gap-2 rounded-full bg-[#0057B8] px-7 py-3.5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(0,87,184,.6)] transition hover:-translate-y-0.5 hover:bg-[#004a9e]"

function Block({ id, tint, flip, title, text, items, cta, children }: { id: string; tint?: boolean; flip?: boolean; title: string; text: string; items: string[]; cta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className={`scroll-mt-16 py-16 sm:py-28 ${tint ? "bg-gradient-to-b from-[#F3F8FE] to-white" : ""}`}>
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 lg:grid-cols-[.85fr_1.15fr] lg:gap-10">
        <Reveal className={flip ? "lg:order-2" : ""}>
          {id === "gestao" ? <h1 id={`${id}-t`} className={H2}>{title}</h1> : <h2 id={`${id}-t`} className={H2}>{title}</h2>}
          <p className="mt-5 max-w-md text-lg text-slate-600">{text}</p>
          <ul className="mt-8 space-y-3.5">{items.map((i) => <Benefit key={i}>{i}</Benefit>)}</ul>
          {cta && <div className="mt-9">{cta}</div>}
        </Reveal>
        <Reveal delay={150} className={flip ? "lg:order-1" : ""}>{children}</Reveal>
      </div>
    </section>
  )
}

const TELAS = [
  { src: "/site/celular-painel.png", w: 660, h: 1240, title: "Painel", text: "Atletas ativos, recebimentos e o próximo jogo num só olhar." },
  { src: "/site/celular-atletas.png", w: 656, h: 1242, title: "Atletas", text: "Todo o elenco com posição, número e gols." },
  { src: "/site/celular-jogos.png", w: 650, h: 1238, title: "Jogos", text: "Calendário, confirmação de presença e escalação." },
  { src: "/site/celular-caixa.png", w: 650, h: 1244, title: "Caixa", text: "Quem pagou, quem está pendente, com um toque para marcar pago." },
]

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
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 })

const INCLUDED = ["Cadastro de atletas", "Mensalidades e caixa", "Jogos e escalações", "Gols e artilharia", "Card para WhatsApp", "Três níveis de acesso"]

export default async function SitePage() {
  const plans = await loadPlans()
  const paid = plans.filter((p) => p.price_cents > 0)
  const hot = paid.length ? paid[0].code : null   // o plano de entrada recebe o selo Popular
  return (
    <>
      <Block id="gestao" tint title="Tudo do seu futebol em um só lugar." text="Organize jogadores, partidas, escalações, mensalidades e estatísticas em uma plataforma simples, inteligente e profissional."
        items={["Gestão completa dos atletas", "Controle de mensalidades", "Organização de partidas", "Escalações automáticas", "Gols e estatísticas em tempo real"]}
        cta={<Link href="/demo" className={CTA}>Experimentar demonstração <ArrowRight className="size-4" /></Link>}>
        <div className="relative px-2 py-8 sm:px-8">
          <Laptop label="Painel do GEAB Futebol (dados ilustrativos)"><DashboardScreen /></Laptop>
          <Float icon={Users} title="Atletas ativos" value="24" className="top-0 left-0 sm:-left-2" />
          <Float icon={CircleDollarSign} title="Mensalidades recebidas" value="R$ 1.870" className="right-0 bottom-2 sm:-right-2" delay={1.5} />
          <Float icon={Trophy} title="Próximo jogo" value="Sábado · 16h" className="top-1/3 -right-1 hidden sm:flex" delay={3} />
        </div>
      </Block>

      <Block id="jogos" flip title="Planeje, organize e entre em campo." text="Gerencie seus jogos, confirme jogadores, distribua equipes e gere escalações profissionais em poucos cliques."
        items={["Calendário de jogos", "Escalação automática", "Times Azul e Branco", "Confirmação de presença", "Cards para WhatsApp"]}>
        <div className="relative pb-10 sm:pr-16">
          <Laptop label="Tela de escalação (dados ilustrativos)"><LineupScreen /></Laptop>
          <Phone label="Card de escalação para WhatsApp (dados ilustrativos)" className="absolute -bottom-2 -right-1 w-[28%] min-w-24 sm:right-0"><LineupCardPhone /></Phone>
        </div>
      </Block>

      <Block id="financeiro" tint title="Controle financeiro sem complicação." text="Saiba quem pagou, acompanhe mensalidades pendentes e tenha uma visão clara das finanças do seu grupo."
        items={["Controle de mensalidades", "Registro de pagamentos", "Acompanhamento de pendências", "Recebimentos via Pix", "Relatórios financeiros", "Histórico de arrecadação"]}>
        <div className="relative px-2 py-8 sm:px-8">
          <Laptop label="Tela de mensalidades (dados ilustrativos)"><FinanceScreen /></Laptop>
          <Float icon={CircleDollarSign} title="Recebido no mês" value="R$ 1.270" className="top-0 right-0 sm:-right-2" />
          <Float icon={Users} title="Pendentes" value="3 atletas" className="bottom-2 left-0 sm:-left-2" delay={2} />
        </div>
      </Block>

      <Block id="atleta" title="Uma central para cada atleta." text="Cada jogador acompanha o próximo jogo, a mensalidade, os gols e a artilharia no celular, sem depender de mensagem no grupo."
        items={["Próximo jogo e último resultado", "Mensalidade com pagamento por Pix", "Gols e posição na artilharia", "Histórico de jogos e de pagamentos", "Perfil e senha sob controle do atleta"]}>
        <AthleteShowcase />
      </Block>

      <section id="celular" aria-labelledby="celular-t" className="scroll-mt-16 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 id="celular-t" className={H2}>Seu grupo na palma da mão.</h2>
            <p className="mt-5 text-lg text-slate-600">Funciona direto no navegador do celular, sem instalar nada. Confira as telas principais.</p>
          </Reveal>
          <ul className="mt-12 grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-8 lg:grid-cols-4">
            {TELAS.map((t, i) => (
              <li key={t.src}>
                <Reveal delay={i * 90} className="flex flex-col items-center text-center">
                  <Image src={t.src} width={t.w} height={t.h} sizes="(min-width: 1024px) 240px, 45vw" alt={`Tela ${t.title} do GEAB Futebol no celular (dados ilustrativos)`}
                    className="h-auto w-full max-w-[15rem] drop-shadow-[0_24px_30px_rgba(23,54,93,.22)]" />
                  <h3 className="mt-5 text-base font-semibold text-[#17365D]">{t.title}</h3>
                  <p className="mt-1 max-w-[16rem] text-sm text-slate-600">{t.text}</p>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <p className="mx-auto max-w-6xl px-5 pb-10 text-center text-xs text-slate-400">Imagens ilustrativas: nomes e valores são fictícios.</p>

      <section id="planos" aria-labelledby="planos-t" className="scroll-mt-16 bg-gradient-to-b from-[#F3F8FE] to-white py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 id="planos-t" className={H2}>Um plano para o tamanho do seu grupo.</h2>
            <p className="mt-4 text-lg text-slate-600">Comece grátis e evolua quando precisar. O que cada plano inclui está listado abaixo.</p>
          </Reveal>
          <div className={`mt-14 grid gap-6 ${plans.length >= 4 ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3"}`}>
            {plans.map((p, i) => (
              <Reveal key={p.code} delay={i * 100}>
                <div className={`flex h-full flex-col rounded-3xl border bg-white p-8 ${p.code === hot ? "border-[#0057B8] shadow-[0_20px_60px_-30px_rgba(0,87,184,.5)]" : "border-slate-200"}`}>
                  <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-[#17365D]">{p.name}</h3>{p.code === hot && <span className="rounded-full bg-[#0057B8] px-3 py-1 text-xs font-medium text-white">Popular</span>}</div>
                  <p className="mt-5"><span className="text-4xl font-bold text-[#17365D]">{p.price_cents ? brl(p.price_cents) : "Grátis"}</span> <span className="text-sm text-slate-500">{p.price_cents ? "por mês" : `por ${p.trial_days} dias`}</span></p>
                  <p className="mt-1 text-sm font-medium text-[#0057B8]">{p.max_athletes ? `Até ${p.max_athletes} jogadores` : "Jogadores ilimitados"} · {p.max_admins ? `${p.max_admins} ${p.max_admins === 1 ? "administrador" : "administradores"}` : "administradores ilimitados"}</p>
                  <ul className="mt-6 flex-1 space-y-3">
                    {INCLUDED.map((x) => <Benefit key={x}>{x}</Benefit>)}
                    {ALL_MODULES.map((m) => p.modules.includes(m)
                      ? <Benefit key={m}>{MODULE_LABEL[m]}</Benefit>
                      : <li key={m} className="flex items-start gap-3 text-[15px] text-slate-400 line-through decoration-slate-300"><span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center text-slate-300">–</span><span><span className="sr-only">Não inclui: </span>{MODULE_LABEL[m]}</span></li>)}
                  </ul>
                  <Link href="/novo-grupo" className={`mt-8 inline-flex justify-center rounded-full px-6 py-3 text-[15px] font-medium transition hover:-translate-y-0.5 ${p.code === hot ? "bg-[#0057B8] text-white hover:bg-[#004a9e]" : "border border-slate-200 text-[#17365D] hover:border-[#0057B8]/40"}`}>{p.price_cents ? `Começar com o ${p.name}` : `Testar ${p.trial_days} dias grátis`}</Link>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="final-t" className="px-5 pb-24">
        <Reveal className="mx-auto max-w-5xl rounded-[2rem] bg-[#17365D] px-6 py-16 text-center sm:py-20">
          <h2 id="final-t" className="mx-auto max-w-2xl text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">Pronto para organizar o seu grupo?</h2>
          <p className="mx-auto mt-4 max-w-lg text-blue-100">Crie o seu grupo agora, ou explore a demonstração antes, sem cadastro.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/novo-grupo" className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-[15px] font-medium text-[#17365D] transition hover:-translate-y-0.5">Criar meu grupo <ArrowRight className="size-4" /></Link>
            <Link href="/demo" className="inline-flex items-center rounded-full border border-white/30 px-7 py-3.5 text-[15px] font-medium text-white transition hover:bg-white/10">Testar demonstração</Link>
          </div>
        </Reveal>
      </section>
    </>
  )
}
