import { isBirthday } from "../src/lib/birthday"
let bad = 0
const t = (n: string, c: boolean) => { console.log(c ? "PASS" : "FAIL", n); if (!c) bad++ }
t("mesmo dia e mês", isBirthday("1990-03-15", "2026-03-15"))
t("dia seguinte não", !isBirthday("1990-03-15", "2026-03-16"))
t("mês diferente, mesmo dia, não", !isBirthday("1990-03-15", "2026-04-15"))
t("nascido no futuro não", !isBirthday("2030-03-15", "2026-03-15"))
t("29/02 em ano bissexto: dia 29", isBirthday("1992-02-29", "2028-02-29"))
t("29/02 em ano bissexto: dia 28 não", !isBirthday("1992-02-29", "2028-02-28"))
t("29/02 em ano comum: comemora dia 28", isBirthday("1992-02-29", "2026-02-28"))
t("29/02 em ano comum: 1º de março não", !isBirthday("1992-02-29", "2026-03-01"))
t("2100 não é bissexto: 29/02 comemora dia 28", isBirthday("2000-02-29", "2100-02-28"))
t("vazio/inválido não", !isBirthday(null) && !isBirthday("") && !isBirthday("15/03/1990", "2026-03-15"))
process.exit(bad ? 1 : 0)
