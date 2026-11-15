/** Utilitários dos relatórios: formatação e exportação (Excel via CSV com ";" e BOM; PDF pela impressão do navegador). */
export const fmtHours = (min: number) => { const h = min / 60; return `${h.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` }
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)
export const fmtPct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
export const moneyCsv = (cents: number) => (cents / 100).toFixed(2).replace(".", ",")

type Cell = string | number | null | undefined
export type Table = { title: string; head: string[]; rows: Cell[][] }
const esc = (v: Cell) => { const s = v == null ? "" : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

/** Baixa uma ou mais tabelas em um arquivo que o Excel abre direto (acentos preservados). */
export function downloadCsv(filename: string, tables: Table[]) {
  const body = tables.map((t) => [esc(t.title), t.head.map(esc).join(";"), ...t.rows.map((r) => r.map(esc).join(";"))].join("\r\n")).join("\r\n\r\n")
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }))
  a.download = filename; a.click(); URL.revokeObjectURL(a.href)
}

const h = (s: Cell) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
/** Abre uma página limpa com as tabelas do relatório e a janela de impressão (escolha "Salvar como PDF"). Conteúdo escapado. */
export function printPdf(title: string, subtitle: string, tables: Table[]) {
  const w = window.open("", "_blank")
  if (!w) return false
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${h(title)}</title><style>
body{font:13px/1.4 system-ui,sans-serif;color:#19221D;margin:24px}h1{font-size:20px;margin:0}p.s{color:#555;margin:2px 0 16px}h2{font-size:14px;margin:18px 0 6px;color:#142C25}
table{border-collapse:collapse;width:100%;margin-bottom:8px}th,td{border:1px solid #d9e0d4;padding:4px 6px;text-align:left}th{background:#F6F8F4}td.n{text-align:right}@page{margin:14mm}</style></head><body>
<h1>${h(title)}</h1><p class="s">${h(subtitle)}</p>${tables.map((t) => `<h2>${h(t.title)}</h2><table><thead><tr>${t.head.map((c) => `<th>${h(c)}</th>`).join("")}</tr></thead><tbody>${t.rows.length ? t.rows.map((r) => `<tr>${r.map((c) => `<td${typeof c === "number" ? ' class="n"' : ""}>${h(c)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${t.head.length}">Sem dados no período.</td></tr>`}</tbody></table>`).join("")}</body></html>`
  w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300)
  return true
}
