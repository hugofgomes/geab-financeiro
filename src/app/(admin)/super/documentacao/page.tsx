"use client"

import { Markdown } from "@/components/docs/markdown"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useLoad } from "@/hooks/use-load"
import { Printer } from "lucide-react"
import * as React from "react"

type Docs = {
  version: string; versionDate: string | null
  stack: { next: string | null; react: string | null; supabase: string | null }
  chapters: { id: string; title: string; revisado: string | null; markdown: string }[]
  migrations: { file: string; summary: string }[]
  tables: { name: string; file: string }[]
  functions: { name: string; file: string; area: string }[]
  pages: { path: string; access: string; description: string | null }[]
  apis: { path: string; methods: string[]; description: string | null }[]
  env: { name: string; scope: string; description: string | null; uses: number }[]
  changelog: { version: string; date: string | null; title: string; novidades: string[]; melhorias: string[]; correcoes: string[] }[]
  stats: { migrations: number; tables: number; functions: number; pages: number; apis: number }
}

const dt = (iso: string | null) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString("pt-BR") : "—")
const minor = (v: string) => v.split(".").slice(0, 2).map(Number)
/** Capítulo revisado numa versão (major.minor) anterior à atual pode estar desatualizado. */
const stale = (rev: string | null, cur: string) => { if (!rev) return true; const a = minor(rev), b = minor(cur); return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) }

const AUTO = [
  { id: "a-historico", title: "Histórico de versões" },
  { id: "a-paginas", title: "Páginas e acessos" },
  { id: "a-apis", title: "Rotas de API" },
  { id: "a-tabelas", title: "Tabelas do banco" },
  { id: "a-funcoes", title: "Funções do banco" },
  { id: "a-migrations", title: "Migrations" },
  { id: "a-env", title: "Variáveis de ambiente" },
]

function Missing() { return <span className="text-amber-700">⚠ sem descrição</span> }
function T({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary/60"><tr>{head.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
const td = "border-t px-3 py-2 align-top"

export default function DocumentacaoPage() {
  const { data, error, loading } = useLoad(async () => {
    const r = await fetch("/api/docs", { cache: "no-store" })
    if (r.status === 403) throw new Error("Acesso restrito ao dono da plataforma.")
    if (!r.ok) throw new Error("Não foi possível carregar a documentação.")
    return (await r.json()) as Docs
  }, [])
  const [q, setQ] = React.useState("")

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (loading && !data) return <Skeleton className="h-60" />
  if (!data) return null
  const d = data
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  const term = n(q.trim())
  const hit = (...s: (string | null | undefined)[]) => !term || n(s.filter(Boolean).join(" ")).includes(term)
  const chapters = d.chapters.filter((c) => hit(c.title, c.markdown))
  const pages = d.pages.filter((p) => hit(p.path, p.access, p.description))
  const apis = d.apis.filter((p) => hit(p.path, p.description, p.methods.join(" ")))
  const tables = d.tables.filter((t) => hit(t.name, t.file))
  const fns = d.functions.filter((f) => hit(f.name, f.area, f.file))
  const migs = d.migrations.filter((m) => hit(m.file, m.summary))
  const env = d.env.filter((e) => hit(e.name, e.description, e.scope))
  const outdated = d.chapters.filter((c) => stale(c.revisado, d.version))
  const nav = [...d.chapters.map((c) => ({ id: c.id, title: c.title })), ...AUTO]

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documentação do sistema</h1>
          <p className="text-sm text-muted-foreground">Versão <b>{d.version}</b> ({dt(d.versionDate)}) · gerada a partir do código a cada publicação · visível só para o dono da plataforma.</p>
        </div>
        <Button variant="outline" className="h-10 sm:h-8" onClick={() => window.print()}><Printer /> Imprimir / PDF</Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 print:hidden">
        {[["Páginas", d.stats.pages], ["APIs", d.stats.apis], ["Tabelas", d.stats.tables], ["Funções SQL", d.stats.functions], ["Migrations", d.stats.migrations]].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border bg-card p-3"><div className="text-2xl font-bold tabular-nums text-primary">{v}</div><div className="text-xs text-muted-foreground">{l}</div></div>
        ))}
      </div>

      {outdated.length > 0 && (
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden">
          ⚠ {outdated.length === 1 ? "1 capítulo foi revisado" : `${outdated.length} capítulos foram revisados`} numa versão anterior e pode estar desatualizado: {outdated.map((c) => c.title).join(", ")}. As seções automáticas (a partir de Histórico de versões) estão sempre atualizadas.
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-3 print:hidden lg:sticky lg:top-20 lg:self-start">
          <Input aria-label="Buscar na documentação" placeholder="Buscar…" className="h-11 sm:h-9" value={q} onChange={(e) => setQ(e.target.value)} />
          <nav aria-label="Índice" className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {nav.map((x) => <a key={x.id} href={`#${x.id}`} className="shrink-0 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">{x.title}</a>)}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          {term && !chapters.length && !pages.length && !apis.length && !tables.length && !fns.length && !migs.length && !env.length && !n("histórico versões").includes(term) &&
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nada encontrado para “{q}”.</p>}

          {chapters.map((c) => (
            <Card key={c.id} id={c.id} className="scroll-mt-20"><CardContent className="space-y-3 pt-4">
              {stale(c.revisado, d.version) && <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900 print:hidden">Revisado na v{c.revisado ?? "?"}: pode estar desatualizado.</p>}
              <Markdown source={c.markdown} />
              {!stale(c.revisado, d.version) && <p className="text-xs text-muted-foreground print:hidden">Revisado na v{c.revisado}</p>}
            </CardContent></Card>
          ))}

          <Card id="a-historico" className="scroll-mt-20"><CardContent className="space-y-3 pt-4">
            <h2 className="text-lg font-semibold text-primary">Histórico de versões</h2>
            {d.changelog.map((e) => (
              <div key={e.version} className="border-t pt-3 first:border-0 first:pt-0">
                <h3 className="text-sm font-semibold">v{e.version} · {e.title} <span className="font-normal text-muted-foreground">({dt(e.date)})</span></h3>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                  {[...e.novidades, ...e.melhorias.map((x) => `Melhoria: ${x}`), ...e.correcoes.map((x) => `Correção: ${x}`)].map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
            ))}
          </CardContent></Card>

          <Card id="a-paginas" className="scroll-mt-20"><CardContent className="space-y-3 pt-4">
            <h2 className="text-lg font-semibold text-primary">Páginas e acessos ({pages.length})</h2>
            <T head={["Endereço", "Quem acessa", "Descrição"]}>{pages.map((p) => <tr key={p.path}><td className={`${td} font-mono text-xs`}>{p.path}</td><td className={td}>{p.access}</td><td className={td}>{p.description ?? <Missing />}</td></tr>)}</T>
          </CardContent></Card>

          <Card id="a-apis" className="scroll-mt-20"><CardContent className="space-y-3 pt-4">
            <h2 className="text-lg font-semibold text-primary">Rotas de API ({apis.length})</h2>
            <T head={["Rota", "Métodos", "Descrição"]}>{apis.map((p) => <tr key={p.path}><td className={`${td} font-mono text-xs`}>{p.path}</td><td className={td}>{p.methods.join(", ")}</td><td className={td}>{p.description ?? <Missing />}</td></tr>)}</T>
          </CardContent></Card>

          <Card id="a-tabelas" className="scroll-mt-20"><CardContent className="space-y-3 pt-4">
            <h2 className="text-lg font-semibold text-primary">Tabelas do banco ({tables.length})</h2>
            <T head={["Tabela", "Criada em"]}>{tables.map((t) => <tr key={t.name}><td className={`${td} font-mono text-xs`}>{t.name}</td><td className={`${td} text-xs text-muted-foreground`}>{t.file}</td></tr>)}</T>
          </CardContent></Card>

          <Card id="a-funcoes" className="scroll-mt-20"><CardContent className="space-y-3 pt-4">
            <h2 className="text-lg font-semibold text-primary">Funções do banco ({fns.length})</h2>
            <T head={["Função", "Área", "Última definição"]}>{fns.map((f) => <tr key={f.name}><td className={`${td} font-mono text-xs`}>{f.name}</td><td className={td}>{f.area}</td><td className={`${td} text-xs text-muted-foreground`}>{f.file}</td></tr>)}</T>
          </CardContent></Card>

          <Card id="a-migrations" className="scroll-mt-20"><CardContent className="space-y-3 pt-4">
            <h2 className="text-lg font-semibold text-primary">Migrations ({migs.length})</h2>
            <T head={["Arquivo", "Resumo"]}>{migs.map((m) => <tr key={m.file}><td className={`${td} font-mono text-xs`}>{m.file}</td><td className={td}>{m.summary}</td></tr>)}</T>
          </CardContent></Card>

          <Card id="a-env" className="scroll-mt-20"><CardContent className="space-y-3 pt-4">
            <h2 className="text-lg font-semibold text-primary">Variáveis de ambiente ({env.length})</h2>
            <p className="text-xs text-muted-foreground">Somente os nomes e para que servem; os valores nunca são exibidos.</p>
            <T head={["Variável", "Onde vale", "Descrição"]}>{env.map((e) => <tr key={e.name}><td className={`${td} font-mono text-xs`}>{e.name}</td><td className={td}>{e.scope}</td><td className={td}>{e.description ?? <Missing />}</td></tr>)}</T>
          </CardContent></Card>
        </div>
      </div>
    </>
  )
}
