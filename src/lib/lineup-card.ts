import { kitDataUrl, type KitColor } from "@/lib/kit"
import { hhmm, shortDate, weekdayOf } from "@/lib/matches"

export type CardPlayer = { name: string; keeper: boolean; number: string }
export type CardFormat = "vertical" | "quadrado"
export type CardData = {
  orgName: string
  tagline: string | null
  website: string | null
  logoUrl: string | null
  format: CardFormat
  date: string
  time: string | null
  venue: string | null
  azul: CardPlayer[]
  branco: CardPlayer[]
  reservas: CardPlayer[]
}

export const CARD_SIZE: Record<CardFormat, { w: number; h: number }> = { vertical: { w: 1080, h: 1350 }, quadrado: { w: 1080, h: 1080 } }

const C = { navy: "#071D3A", blue: "#0057B8", light: "#F3F6FA", gold: "#FFC83D", sky: "#5FA8FF" }
const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`
const font = (px: number, w = 800) => `${w} ${px}px ${FONT}`

const imgCache = new Map<string, Promise<HTMLImageElement>>()
function kitImage(color: KitColor, number: string) {
  const url = kitDataUrl(color, number || null)
  let p = imgCache.get(url)
  if (!p) {
    p = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Falha ao carregar o uniforme")); i.src = url })
    imgCache.set(url, p)
  }
  return p
}

type Ctx = CanvasRenderingContext2D

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

/** Desenha o texto centralizado sem cortar: reduz a fonte e, se preciso, quebra em duas linhas. */
function drawFitted(ctx: Ctx, text: string, cx: number, top: number, maxW: number, maxH: number, color: string, start: number, min = 13, weight = 800) {
  ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"
  for (let s = start; s >= min; s--) {
    ctx.font = font(s, weight)
    if (ctx.measureText(text).width <= maxW && s * 1.1 <= maxH) { ctx.fillText(text, cx, top + s); return }
  }
  const words = text.split(" ")
  if (words.length > 1) {
    for (let s = Math.min(start, 26); s >= min; s--) {
      ctx.font = font(s, weight)
      let best: [string, string] | null = null, bestW = Infinity
      for (let i = 1; i < words.length; i++) {
        const l1 = words.slice(0, i).join(" "), l2 = words.slice(i).join(" ")
        const w = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width)
        if (w < bestW) { bestW = w; best = [l1, l2] }
      }
      if (best && bestW <= maxW && s * 2.15 <= maxH) { ctx.fillText(best[0], cx, top + s); ctx.fillText(best[1], cx, top + s * 2.05); return }
    }
  }
  ctx.font = font(min, weight)
  let t = text
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1)
  ctx.fillText(t.length < text.length ? t + "…" : t, cx, top + min)
}

function drawTeam(ctx: Ctx, imgs: Map<string, HTMLImageElement>, color: KitColor, players: CardPlayer[], x: number, w: number, top: number, bottom: number, cols: number, rows: number) {
  const label = color === "azul" ? "TIME AZUL" : "TIME BRANCO"
  const bandH = 58
  ctx.fillStyle = color === "azul" ? C.blue : "#FFFFFF"
  roundRect(ctx, x, top, w, bandH, 14); ctx.fill()
  ctx.fillStyle = color === "azul" ? "#FFFFFF" : C.navy
  ctx.font = font(30); ctx.textAlign = "center"; ctx.textBaseline = "middle"
  ctx.fillText(`${label}  ·  ${players.length}`, x + w / 2, top + bandH / 2 + 1)
  ctx.textBaseline = "alphabetic"

  const gridTop = top + bandH + 12
  const cellW = w / cols
  const cellH = Math.min(215, (bottom - gridTop) / rows)
  players.forEach((p, i) => {
    const col = i % cols, row = Math.floor(i / cols)
    const cx = x + col * cellW + cellW / 2, cy = gridTop + row * cellH
    ctx.fillStyle = "rgba(255,255,255,0.05)"
    roundRect(ctx, x + col * cellW + 4, cy + 3, cellW - 8, cellH - 6, 14); ctx.fill()
    const nameH = Math.max(34, cellH * 0.3)
    const kitH = Math.min(cellH - nameH - 14, cellW * 0.72 * 1.32)
    const kitW = kitH * 100 / 132
    const img = imgs.get(`${color}|${p.number}`)
    if (img) ctx.drawImage(img, cx - kitW / 2, cy + 8, kitW, kitH)
    if (p.keeper) {
      ctx.fillStyle = C.gold; roundRect(ctx, cx + kitW / 2 - 6, cy + 8, 46, 24, 7); ctx.fill()
      ctx.fillStyle = C.navy; ctx.font = font(16, 900); ctx.textAlign = "center"; ctx.fillText("GOL", cx + kitW / 2 + 17, cy + 25)
    }
    drawFitted(ctx, p.name.toUpperCase(), cx, cy + 8 + kitH + 6, cellW - 14, nameH, p.keeper ? C.gold : "#FFFFFF", 26, 12)
  })
}

/** Desenha o card inteiro no canvas (tamanho final de exportação). A prévia usa este mesmo canvas. */
export async function drawLineupCard(canvas: HTMLCanvasElement, d: CardData) {
  const { w: W, h: H } = CARD_SIZE[d.format]
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext("2d")!

  const need = new Map<string, [KitColor, string]>()
  for (const p of d.azul) need.set(`azul|${p.number}`, ["azul", p.number])
  for (const p of d.branco) need.set(`branco|${p.number}`, ["branco", p.number])
  const imgs = new Map<string, HTMLImageElement>()
  await Promise.all([...need].map(async ([k, [c, n]]) => { imgs.set(k, await kitImage(c, n)) }))

  // Logotipo do grupo (opcional): se a imagem não carregar ou bloquear exportação (CORS), o card sai sem ele.
  let logo: HTMLImageElement | null = null
  if (d.logoUrl) {
    logo = await new Promise<HTMLImageElement | null>((res) => {
      const i = new Image(); i.crossOrigin = "anonymous"
      i.onload = () => res(i); i.onerror = () => res(null); i.src = d.logoUrl!
      setTimeout(() => res(null), 6000)
    })
  }

  // Fundo
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H)
  g.addColorStop(0, "#0A2A55"); g.addColorStop(1, C.navy)
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  ctx.save(); ctx.globalAlpha = 0.05; ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 46
  for (let x = -H; x < W + H; x += 140) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.stroke() }
  ctx.restore()

  // Cabeçalho
  const logoBox = logo ? 120 : 0
  if (logo) {
    const k = Math.min(logoBox / logo.width, logoBox / logo.height)
    ctx.drawImage(logo, 40, 24 + (logoBox - logo.height * k) / 2, logo.width * k, logo.height * k)
  }
  drawFitted(ctx, d.orgName.toUpperCase(), W / 2, 22, W - 2 * (logoBox ? logoBox + 60 : 60), 80, "#FFFFFF", 70, 26, 900)
  ctx.fillStyle = C.sky; ctx.font = font(34, 800)
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = "6px"
  ctx.fillText("ESCALAÇÃO OFICIAL", W / 2, 142)
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px"
  ctx.fillStyle = C.blue; ctx.fillRect(W / 2 - 60, 160, 120, 5)
  const parts = [`${weekdayOf(d.date).toUpperCase()} ${shortDate(d.date)}`, hhmm(d.time), d.venue?.trim() || null].filter(Boolean) as string[]
  drawFitted(ctx, parts.join("  ·  "), W / 2, 178, W - 80, 44, C.light, 30, 16, 700)

  // Corpo
  const top = 250, footerH = 104
  let bottom = H - footerH - 6
  if (d.reservas.length) {
    const rsH = 112
    bottom -= rsH
    const ry = bottom + 12
    ctx.fillStyle = "rgba(255,255,255,0.07)"; roundRect(ctx, 36, ry, W - 72, rsH - 10, 14); ctx.fill()
    ctx.fillStyle = C.sky; ctx.font = font(22); ctx.textAlign = "left"; ctx.fillText("RESERVAS", 56, ry + 32)
    drawFitted(ctx, d.reservas.map((p) => p.name.toUpperCase()).join("  ·  "), W / 2, ry + 42, W - 120, rsH - 58, C.light, 24, 12, 700)
  }
  const most = Math.max(d.azul.length, d.branco.length, 1)
  const cols = most > 10 ? 3 : 2
  const rows = Math.max(1, Math.ceil(most / cols))
  const colW = (W - 36 * 2 - 36) / 2
  drawTeam(ctx, imgs, "azul", d.azul, 36, colW, top, bottom, cols, rows)
  drawTeam(ctx, imgs, "branco", d.branco, W - 36 - colW, colW, top, bottom, cols, rows)
  ctx.save(); ctx.setLineDash([8, 10]); ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(W / 2, top); ctx.lineTo(W / 2, bottom); ctx.stroke(); ctx.restore()

  // Rodapé
  ctx.fillStyle = C.blue; ctx.fillRect(0, H - footerH, W, 3)
  const foot = d.tagline ? `${d.orgName}  ·  ${d.tagline}` : d.orgName
  drawFitted(ctx, foot, W / 2, d.website ? H - 82 : H - 66, W - 80, 36, "#FFFFFF", 28, 14, 800)
  if (d.website) drawFitted(ctx, d.website, W / 2, H - 44, W - 80, 30, C.sky, 26, 14, 700)
}

export function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Não foi possível gerar a imagem"))), "image/png"))
}
