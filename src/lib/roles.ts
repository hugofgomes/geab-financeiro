/** Três níveis de acesso. O banco (RLS) é a barreira de verdade; a tela só esconde o que a pessoa não pode usar. */
export type Role = "atleta" | "diretoria" | "admin"

export const ROLE_LABEL: Record<Role, string> = { atleta: "Atleta", diretoria: "Diretoria", admin: "Administrador" }
export const ROLE_HELP: Record<Role, string> = {
  atleta: "vê só a própria conta, as próprias mensalidades e os próprios dados",
  diretoria: "consulta todas as áreas (atletas, mensalidades, caixa, extrato, jogos, escalação), sem alterar nada e sem acessar a administração",
  admin: "vê e gerencia tudo, inclusive usuários e privilégios",
}

/** Área administrativa e telas de operação: fora do alcance da Diretoria (que só consulta). */
const ADMIN_ONLY = ["/usuarios", "/importar", "/grupo", "/super", "/ao-vivo"]
export const isAdminOnlyPath = (p: string) => ADMIN_ONLY.some((x) => p === x || p.startsWith(x + "/"))
export const isStaff = (r: string | null | undefined) => r === "admin" || r === "diretoria"
