<!-- revisado: 1.13.0 -->
# Integrações

## Asaas (assinaturas do SaaS)
Cobrança recorrente dos clientes. Ver o capítulo de planos e assinatura.

## E-mail (SMTP / Resend)
- **E-mails do sistema** (confirmação de cadastro, recuperação de senha, convites): SMTP do Supabase Auth apontando para a Resend (`smtp.resend.com`, porta 465, usuário `resend`, senha = chave da Resend).
- **E-mails do aplicativo** (confirmação de pagamento ao atleta, avisos de vencimento, resumo ao dono): o servidor usa nodemailer com as variáveis `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` e `SMTP_FROM_NAME` (a chave da Resend também é usada aqui).
- Domínio de envio verificado: `vendadigital.com`.

## Pix automático (BTG e OpenPix)
- Gera cobranças Pix (QR e copia e cola) para as mensalidades dos atletas e recebe a baixa por webhook (`/api/webhooks/btg`, `/api/webhooks/openpix`).
- **Credenciais globais do servidor pertencem a um único grupo**: o definido em `PLATFORM_ORG_SLUG` (padrão `geab`). Os demais grupos usam o **Pix manual** (código do próprio grupo) até existir credencial por grupo.
- O BTG usa fluxo de autorização (`/api/btg/conectar` e `/api/btg/callback`); a conexão fica em `btg_connection` (nunca exportada).

## WhatsApp Cloud API
Confirmação de pagamento por mensagem com modelo aprovado (`WHATSAPP_*`). Só para o grupo dono do servidor e só para atletas que deram consentimento.

## Importação do Google Sheets
Lê planilhas "publicadas na web" (`/api/planilha`); só aceita endereços do Google.

## Supabase
- **Banco e Auth**: um único projeto para todos os grupos.
- **Chaves**: a chave pública (*anon*) vai no navegador; a chave de serviço (`SUPABASE_SERVICE_ROLE_KEY`) só existe no servidor e é usada pelos webhooks, pela rotina diária e pela criação de acessos.
