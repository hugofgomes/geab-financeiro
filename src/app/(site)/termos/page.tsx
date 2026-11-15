import { LegalPage } from "@/components/site/legal"
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = { title: "Termos de uso | GEAB Futebol", description: "Condições de uso da plataforma GEAB Futebol: teste gratuito, assinatura, responsabilidades e encerramento.", alternates: { canonical: "/termos" } }

export default function TermosPage() {
  return (
    <LegalPage title="Termos de uso" updated="15/11/2026">
      <p>Estes termos regulam o uso da plataforma <strong>GEAB Futebol</strong>. Ao criar um grupo ou usar o sistema, você declara que leu e concorda com eles e com a <Link href="/privacidade">Política de privacidade</Link>.</p>

      <h2>O serviço</h2>
      <p>O GEAB Futebol oferece ferramentas para organizar grupos de futebol: cadastro de atletas, jogos, escalações, gols, mensalidades, caixa e área do atleta. Os recursos disponíveis dependem do plano contratado.</p>

      <h2>Conta e responsabilidades</h2>
      <ul>
        <li>Quem cria o grupo torna-se o Administrador e responde pelas informações cadastradas, pelas pessoas que recebem acesso e pelo uso lícito dos dados dos atletas.</li>
        <li>Mantenha a senha em sigilo e informe dados verdadeiros e atualizados.</li>
        <li>É proibido usar o sistema para fins ilegais, tentar acessar dados de outros grupos ou comprometer a segurança da plataforma.</li>
      </ul>

      <h2>Teste gratuito e assinatura</h2>
      <p>Todo grupo novo tem um período de teste gratuito, sem cartão, cuja duração e limites estão informados na página de planos. Ao fim do teste, o acesso é bloqueado até a contratação de um plano; os dados ficam guardados. A assinatura é mensal e recorrente, paga por Pix, boleto ou cartão por meio do Asaas, e pode ser cancelada quando você quiser.</p>

      <h2>Atraso, suspensão e cancelamento</h2>
      <p>Em caso de pagamento em atraso, o acesso do grupo pode ser suspenso até a regularização, sem perda de dados. O cancelamento interrompe as próximas cobranças. A plataforma também pode suspender contas que violem estes termos.</p>

      <h2>Dados após o encerramento</h2>
      <p>Se o grupo for encerrado, os dados ficam disponíveis para recuperação por um prazo (padrão de 30 dias) e depois são apagados definitivamente. Antes disso, é possível solicitar a exportação dos dados.</p>

      <h2>Disponibilidade e limitação de responsabilidade</h2>
      <p>Trabalhamos para manter o sistema disponível e seguro, mas ele é oferecido no estado em que se encontra, sem garantia de funcionamento ininterrupto. Na medida permitida em lei, a plataforma não responde por perdas indiretas decorrentes de indisponibilidade, uso indevido da conta pelo próprio usuário ou informações cadastradas incorretamente.</p>

      <h2>Alterações</h2>
      <p>Estes termos podem ser atualizados; a data de atualização fica no topo. O uso continuado após a mudança indica concordância.</p>

      <h2>Lei aplicável</h2>
      <p>Estes termos são regidos pelas leis do Brasil. Dúvidas ou solicitações: <a href="https://vendadigital.com" target="_blank" rel="noreferrer">vendadigital.com</a>.</p>
    </LegalPage>
  )
}
