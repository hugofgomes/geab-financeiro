/** Uniformes (camisa, calção e meiões) em SVG. Usados na tela e desenhados no card exportado. */
export type KitColor = "azul" | "branco"

const PALETTE = {
  azul: { main: "#0057B8", dark: "#003D82", trim: "#FFFFFF", line: "#003D82", num: "#FFFFFF" },
  branco: { main: "#FFFFFF", dark: "#E4EAF2", trim: "#0057B8", line: "#9FB0C4", num: "#0057B8" },
} as const

export function kitSvg(color: KitColor, number?: string | null) {
  const c = PALETTE[color]
  const num = number ? `<text x="50" y="58" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${number.length > 1 ? 20 : 24}" fill="${c.num}">${number.replace(/[^0-9]/g, "")}</text>` : ""
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 132" width="100" height="132">
  <g stroke="${c.line}" stroke-width="1.6" stroke-linejoin="round">
    <path d="M31 9 L43 4 Q50 13 57 4 L69 9 L93 29 L83 47 L72 41 L72 80 L28 80 L28 41 L17 47 L7 29 Z" fill="${c.main}"/>
    <path d="M28 82 L72 82 L77 108 L53 108 L50 97 L47 108 L23 108 Z" fill="${c.main}"/>
    <path d="M28 112 L45 112 L44 126 Q44 130 40 130 L33 130 Q29 130 29 126 Z" fill="${c.main}"/>
    <path d="M55 112 L72 112 L71 126 Q71 130 67 130 L60 130 Q56 130 56 126 Z" fill="${c.main}"/>
  </g>
  <path d="M43 4 Q50 13 57 4" fill="none" stroke="${c.trim}" stroke-width="3" stroke-linecap="round"/>
  <path d="M7 29 L17 47 M93 29 L83 47" stroke="${c.trim}" stroke-width="3.2" stroke-linecap="round" fill="none"/>
  <path d="M28 82 L72 82" stroke="${c.trim}" stroke-width="3" fill="none"/>
  <path d="M29 116 L44 116 M56 116 L71 116" stroke="${c.trim}" stroke-width="3" fill="none"/>
  ${num}
</svg>`
}

export const kitDataUrl = (color: KitColor, number?: string | null) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(kitSvg(color, number))}`
