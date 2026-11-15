/** Marca da instalação. NEXT_PUBLIC_BRAND=partidou (variável de build da aplicação do Partidou) liga a identidade do Partidou no sistema todo;
 *  sem ela, o sistema mantém a identidade do GEAB. As cores do Partidou estão também em globals.css (.brand-partidou). */
export const IS_PARTIDOU = process.env.NEXT_PUBLIC_BRAND === "partidou"
export const PARTIDOU = { verdeEscuro: "#142C25", lima: "#B9F344", brancoGelo: "#F6F8F4", grafite: "#19221D" } as const
export const BRAND_NAME = IS_PARTIDOU ? "Partidou" : "GEAB Futebol"
/** Cor principal para gráficos e e-mails (onde não dá para usar a variável CSS). */
export const BRAND_PRIMARY = IS_PARTIDOU ? PARTIDOU.verdeEscuro : "#1E3A5F"
