import pkg from "../../package.json"
import changelog from "@/data/changelog.json"

export type ChangelogEntry = { version: string; date: string | null; title: string; novidades: string[]; melhorias: string[]; correcoes: string[] }

/** Versão do sistema: vem só do package.json (nunca digitada em componentes). */
export const APP_VERSION: string = pkg.version
/** Histórico, da versão mais recente para a mais antiga. */
export const CHANGELOG = changelog.entries as ChangelogEntry[]
/** Data real da publicação da versão atual (do histórico, não do relógio do computador). */
export const RELEASE_DATE: string | null = CHANGELOG.find((e) => e.version === APP_VERSION)?.date ?? null

/** AAAA-MM-DD → DD/MM/AAAA, sem fuso horário. */
export const fmtDate = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : null)
