import * as React from "react"

// Markdown mínimo e seguro (sem HTML cru): títulos, parágrafos, listas, tabelas, citações, blocos de código, negrito, código em linha e links.
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0, i = 0, m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith("**")) out.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith("*")) out.push(<em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>)
    else if (t.startsWith("`")) out.push(<code key={`${key}-${i++}`} className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.85em]">{t.slice(1, -1)}</code>)
    else {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!
      out.push(/^(https?:\/\/|\/)/.test(href) ? <a key={`${key}-${i++}`} href={href} className="text-primary underline" target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{label}</a> : label)
    }
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())

export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n")
  const blocks: React.ReactNode[] = []
  let i = 0, k = 0
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    const key = `b${k++}`
    if (l.startsWith("```")) {
      const code: string[] = []; i++
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++])
      i++
      blocks.push(<pre key={key} className="overflow-x-auto rounded-lg bg-secondary p-3 text-xs"><code>{code.join("\n")}</code></pre>)
    } else if (/^#{1,4}\s/.test(l)) {
      const n = l.match(/^#+/)![0].length, t = l.replace(/^#+\s*/, "")
      const cls = n === 1 ? "mt-0 text-2xl font-bold tracking-tight text-primary" : n === 2 ? "mt-6 text-lg font-semibold text-primary" : "mt-4 text-base font-semibold"
      blocks.push(React.createElement(`h${n}`, { key, className: cls }, inline(t, key)))
      i++
    } else if (l.trim().startsWith("|") && lines[i + 1]?.includes("---")) {
      const head = cells(l); i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]))
      blocks.push(
        <div key={key} className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary/60"><tr>{head.map((h, j) => <th key={j} className="px-3 py-2 font-medium">{inline(h, `${key}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, a) => <tr key={a} className="border-t align-top">{r.map((c, j) => <td key={j} className="px-3 py-2">{inline(c, `${key}r${a}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
    } else if (/^\s*[-*]\s/.test(l) || /^\s*\d+\.\s/.test(l)) {
      const ordered = /^\s*\d+\.\s/.test(l)
      const items: string[] = []
      while (i < lines.length && (ordered ? /^\s*\d+\.\s/ : /^\s*[-*]\s/).test(lines[i])) items.push(lines[i++].replace(/^\s*(?:[-*]|\d+\.)\s+/, ""))
      const L = ordered ? "ol" : "ul"
      blocks.push(React.createElement(L, { key, className: `${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5 text-sm` }, items.map((t, j) => <li key={j}>{inline(t, `${key}i${j}`)}</li>)))
    } else if (l.startsWith(">")) {
      const q: string[] = []
      while (i < lines.length && lines[i].startsWith(">")) q.push(lines[i++].replace(/^>\s?/, ""))
      blocks.push(<blockquote key={key} className="border-l-4 border-primary/40 pl-3 text-sm text-muted-foreground">{inline(q.join(" "), key)}</blockquote>)
    } else {
      const p: string[] = []
      while (i < lines.length && lines[i].trim() && !/^(#|```|>|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i])) p.push(lines[i++])
      if (!p.length) { i++; continue }
      blocks.push(<p key={key} className="text-sm leading-relaxed">{inline(p.join(" "), key)}</p>)
    }
  }
  return <div className="space-y-3">{blocks}</div>
}
