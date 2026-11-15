import { LegalPage } from "@/components/site/legal"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Política de privacidade | GEAB Futebol", description: "Como o GEAB Futebol coleta, usa e protege os dados dos grupos e dos atletas.", alternates: { canonical: "/privacidade" } }

export default function PrivacidadePage() {
  return (
    <LegalPage title="Política de privacidade" updated="15/11/2026">
      <p>Esta política explica quais dados o <strong>GEAB Futebol</strong> trata, para que servem, com quem são compartilhados e quais são os seus direitos, conforme a Lei Geral de Proteção de Dados (LGPD, Lei nº 13.709/2018).</p>

      <h2>Quem é responsável pelos dados</h2>
      <p>O GEAB Futebol é uma plataforma usada por grupos de futebol. Cada grupo (a Diretoria que o administra) decide quais atletas cadastrar e para quê, sendo o responsável pelos dados dos seus atletas. A plataforma trata esses dados em nome do grupo, apenas para fornecer o serviço.</p>

      <h2>Quais dados tratamos</h2>
      <ul>
        <li><strong>Conta e acesso:</strong> nome, e-mail, telefone/WhatsApp e senha (guardada de forma protegida pelo serviço de autenticação).</li>
        <li><strong>Cadastro de atletas:</strong> nome, apelido, data de nascimento, telefone, e-mail e a posição no grupo.</li>
        <li><strong>Financeiro do grupo:</strong> mensalidades, pagamentos, despesas e entradas, com valores e datas.</li>
        <li><strong>Jogos:</strong> partidas, escalações, gols e estatísticas.</li>
        <li><strong>Uso do sistema:</strong> registro de acessos por dia (quem abriu o sistema e o tipo de aparelho) e registros de auditoria de alterações importantes.</li>
        <li><strong>Assinatura:</strong> dados necessários para a cobrança (nome e CPF/CNPJ de quem paga), tratados pelo provedor de pagamento. Não guardamos dados de cartão.</li>
      </ul>

      <h2>Para que usamos</h2>
      <ul>
        <li>Prestar o serviço: cadastro, mensalidades, jogos, escalações e a área do atleta.</li>
        <li>Enviar mensagens do serviço: confirmação de cadastro, recuperação de senha, avisos de teste e de assinatura e, quando você aceitar, confirmação de pagamento por WhatsApp ou e-mail.</li>
        <li>Enviar comunicados sobre novidades e manutenções aos responsáveis pelos grupos clientes (é possível pedir para não receber).</li>
        <li>Manter a segurança, prevenir fraudes e cumprir obrigações legais.</li>
      </ul>

      <h2>Com quem compartilhamos</h2>
      <p>Usamos prestadores de serviço para operar a plataforma, que recebem apenas o necessário: hospedagem, banco de dados e autenticação (Supabase), cobrança de assinaturas (Asaas), envio de e-mails (Resend), Pix automático (BTG ou OpenPix, quando o grupo os utiliza) e mensagens por WhatsApp (WhatsApp Cloud API, somente para quem consentiu). Não vendemos dados pessoais.</p>

      <h2>Isolamento entre grupos e acesso de suporte</h2>
      <p>Os dados de cada grupo ficam separados dos demais, por regras aplicadas no próprio banco de dados. Para dar suporte, a equipe da plataforma pode acessar a conta de um grupo em modo <strong>somente leitura</strong>, por tempo limitado, com motivo informado e com registro de cada acesso.</p>

      <h2>Por quanto tempo guardamos</h2>
      <p>Enquanto a conta do grupo existir. Quando um grupo é encerrado, os dados ficam guardados por um prazo de recuperação (padrão de 30 dias) e depois são apagados definitivamente. Cópias de segurança são mantidas por período limitado.</p>

      <h2>Seus direitos</h2>
      <p>Você pode pedir confirmação do tratamento, acesso, correção, anonimização ou eliminação dos seus dados, portabilidade e a revogação de consentimentos (como o de receber mensagens por WhatsApp). Como os dados dos atletas pertencem ao grupo, o pedido deve ser feito primeiro à administração do seu grupo; se precisar, fale também com o suporte da plataforma pelo site <a href="https://vendadigital.com" target="_blank" rel="noreferrer">vendadigital.com</a>.</p>

      <h2>Cookies e armazenamento no aparelho</h2>
      <p>Usamos apenas o necessário para o funcionamento: a sessão de login e preferências simples (como menu recolhido ou aviso dispensado). Não usamos cookies de publicidade.</p>

      <h2>Segurança</h2>
      <p>Conexões protegidas (HTTPS), acesso por perfis (Administrador, Diretoria e Atleta), isolamento entre grupos, registros de auditoria e cópias de segurança. Nenhum sistema é totalmente imune a riscos; em caso de incidente relevante, comunicaremos os afetados conforme a lei.</p>

      <h2>Mudanças nesta política</h2>
      <p>Podemos atualizar este texto. A data de atualização fica no topo da página.</p>
    </LegalPage>
  )
}
