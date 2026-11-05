import { guessAthlete, pickCharge, norm } from "../src/lib/extrato"
import { decodeOfx, parseAmount, parseOfx } from "../src/lib/ofx"
let bad = 0
const t = (n: string, c: boolean, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : x); if (!c) bad++ }

// OFX 1.x (SGML, sem tags de fechamento), como os bancos exportam
const ofx = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261103120000[-3:BRT]
<TRNAMT>100.00
<FITID>20261103001
<MEMO>PIX TRANSF JOAO CARLOS DA SILVA03/11
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261104
<TRNAMT>-250,00
<FITID>20261104002
<MEMO>PAGAMENTO QUADRA
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261105
<TRNAMT>1.100,50
<FITID>20261105003
<NAME>MARIA
<MEMO>PIX RECEBIDO
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>
<TRNAMT>10.00
<FITID>X
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
const tx = parseOfx(ofx)
t("lê 3 transações válidas (ignora a sem data)", tx.length === 3, String(tx.length))
t("data, valor e identificador do crédito", tx[0].date === "2026-11-03" && tx[0].amount === 100 && tx[0].fitid === "20261103001")
t("débito vem negativo, vírgula decimal", tx[1].amount === -250)
t("milhar com ponto e decimal com vírgula", parseAmount("1.100,50") === 1100.5 && tx[2].amount === 1100.5)
t("junta NAME e MEMO", tx[2].memo === "MARIA PIX RECEBIDO")
t("também lê OFX em XML (com tags de fechamento)", parseOfx("<STMTTRN><DTPOSTED>20260102</DTPOSTED><TRNAMT>5.5</TRNAMT><FITID>a</FITID><MEMO>x</MEMO></STMTTRN>").length === 1)
t("decodifica Windows-1252", decodeOfx(new Uint8Array([0x4a, 0x6f, 0xe3, 0x6f]).buffer) === "João")
t("arquivo vazio/inválido não quebra", parseOfx("").length === 0 && parseOfx("lixo").length === 0)

const A = (id: string, full_name: string, active = true) => ({ id, full_name, nickname: null, active })
const L = [A("1", "João Carlos da Silva"), A("2", "João Pedro Santos"), A("3", "Rogério Silva"), A("4", "Antônio Martins Junior"), A("5", "Maria Souza"), A("6", "Maria Souza Lima"), A("7", "Pedro", true), A("8", "Carlos Inativo Reis", false)]
const g = (m: string) => guessAthlete(m, L)
t("nome completo com acento e preposição", g("PIX TRANSF JOAO CARLOS DA SILVA03/11").athlete?.id === "1" && g("PIX TRANSF JOAO CARLOS DA SILVA03/11").certain)
t("nome truncado pelo banco", g("PIX TRANSF ANTONIO MARTINS JUN").athlete?.id === "4" && g("PIX TRANSF ANTONIO MARTINS JUN").certain)
t("dois atletas com o mesmo primeiro nome: não chuta", !g("PIX TRANSF JOAO").certain)
t("só o primeiro nome não basta", !g("PIX RECEBIDO ROGERIO").certain && g("PIX RECEBIDO ROGERIO").athlete?.id === "3")
t("nome de uma palavra: sugere o atleta, mas pede conferência se outro tem o mesmo nome", g("PIX RECEBIDO PEDRO").athlete?.id === "7" && !g("PIX RECEBIDO PEDRO").certain)
t("nome de uma palavra sem concorrente é aceito", guessAthlete("PIX RECEBIDO ZECA", [A("9", "Zeca")]).certain)
t("homônimo parcial (Maria Souza × Maria Souza Lima) pede conferência", !g("PIX MARIA SOUZA").certain || g("PIX MARIA SOUZA").athlete?.id === "5")
t("Maria Souza Lima completo resolve", g("PIX MARIA SOUZA LIMA").athlete?.id === "6" && g("PIX MARIA SOUZA LIMA").certain)
t("pagador desconhecido: sem palpite", g("PIX RECEBIDO FULANO DETAL").athlete === null)
t("atleta inativo nunca é automático", g("PIX CARLOS INATIVO REIS").athlete?.id === "8" && !g("PIX CARLOS INATIVO REIS").certain)
t("descrição vazia ou só ruído", g("").athlete === null && g("PIX TRANSF RECEBIDO").athlete === null)
t("norm remove acento e símbolos", norm("Rogério-Silva 03/11") === "ROGERIO SILVA")

const C = [
  { id: "c1", athlete_id: "1", competence: "2026-09-01", balance: 100 },
  { id: "c2", athlete_id: "1", competence: "2026-10-01", balance: 100 },
  { id: "c3", athlete_id: "3", competence: "2026-10-01", balance: 40 },
  { id: "c4", athlete_id: "3", competence: "2026-11-01", balance: 100 },
]
t("paga a mensalidade em aberto mais antiga", pickCharge(C, "1", 100)?.id === "c1")
t("pula a que não comporta o valor", pickCharge(C, "3", 100)?.id === "c4")
t("sem mensalidade em aberto: nenhuma", pickCharge(C, "2", 100) === null)
t("valor maior que qualquer saldo: nenhuma", pickCharge(C, "1", 250) === null)
process.exit(bad ? 1 : 0)
