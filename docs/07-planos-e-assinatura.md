<!-- revisado: 1.18.0 -->
# Planos, teste grátis e assinatura

## Planos (tabela `plans`, editável no Painel do SaaS)
| Código | Nome | Preço inicial | Observação |
|---|---|---|---|
| `teste` | Teste gratuito | R$ 0 | Dias de teste = `trial_days` deste plano (hoje 10), limite de atletas e módulos próprios |
| `basico` | Básico | R$ 99/mês | Entrada |
| `pro` | Profissional | R$ 150/mês | |
| `premium` | Premium | sem preço | Nasce **inativo**: só aparece para venda quando o dono define o valor e ativa |
| `ilimitado` | Ilimitado (interno) | R$ 0 | Usado pelo grupo do próprio dono; nunca é exibido |

Cada plano define: preço, limite de atletas, limite de administradores, duração do teste, módulos incluídos (`importar`, `ao_vivo`, `pix`, `mensagens`, `quadras`), limite de quadras ativas (`max_courts`, só com o módulo `quadras`) e uma **referência de gateway** (campo de preparação para integração futura). Plano desativado some das escolhas, mas os grupos que o usam continuam nele. Preço e limites são decididos **no banco**: o navegador nunca informa o valor cobrado.

## Ciclo de vida do grupo
1. **Cadastro** → grupo em `teste`, com `trial_ends_at = agora + dias do plano de teste`.
2. **Avisos** por e-mail ao administrador: 3 dias antes, no último dia, ao terminar o teste.
3. **Fim do teste sem assinar** → acesso bloqueado (os dados ficam guardados); a tela de assinatura permite assinar.
4. **Assinatura** (Asaas) → pagamento confirmado deixa o grupo `ativa`, no plano contratado.
5. **Atraso** → grupo `suspensa` por inadimplência (aviso por e-mail); volta sozinho quando o pagamento entra.
6. **Cancelamento** da assinatura → `cancelada`.

Suspensão ou cancelamento **manuais** do dono nunca são desfeitos por um pagamento.

## Integração com o Asaas
- `POST /api/assinatura`: o administrador escolhe o plano e informa CPF/CNPJ; o servidor cria cliente e assinatura e devolve o link de pagamento (Pix, boleto ou cartão).
- `POST /api/webhooks/asaas`: recebe os eventos. A autenticidade vem do cabeçalho `asaas-access-token` (= `ASAAS_WEBHOOK_TOKEN`). Quem decide é a função `billing_event` (idempotente): `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` ativam; `PAYMENT_OVERDUE` suspende; `SUBSCRIPTION_DELETED`/`SUBSCRIPTION_INACTIVATED` cancelam. Grupos excluídos ignoram os eventos.
- Estado da cobrança por grupo: tabela `org_billing` (cliente, assinatura, pago até, último evento).
- Ambiente: `ASAAS_ENV` (`production` ou `sandbox`) e `ASAAS_API_KEY`. A chave do Asaas começa com `$`: no Coolify a variável precisa estar marcada como **literal**.

## Notificações de vencimento
- Rotina diária `GET/POST /api/cron/vencimentos`, protegida por `CRON_SECRET`, agendada no Coolify (todos os dias às 12:00 UTC = 9h de Brasília).
- O banco decide quem deve receber (`billing_notify_candidates`) e registra cada envio (`org_notifications`): **cada aviso sai uma única vez**; falhas são tentadas de novo no dia seguinte.
- Destinatários: administradores ativos do grupo e o e-mail do responsável cadastrado. Resumo diário opcional ao dono (`PLATFORM_ALERT_EMAIL`).
- Tipos: `trial_3d`, `trial_1d`, `trial_fim`, `inadimplencia`.
