<!-- revisado: 1.18.0 -->
# Painel do SaaS (dono da plataforma)

Acesso: apenas contas em `platform_admins`. O menu mostra **Painel do SaaS**, **Log de acessos**, **Comunicados**, **Documentação**, **Site comercial** e **Demonstração**.

## Dashboard (`/super`)
- Cards: total de clientes, ativos, suspensos, em teste, assinaturas vencidas, MRR (e ARR), novos no mês, cancelamentos do mês.
- Gráficos: crescimento de clientes e evolução do MRR. O banco não guarda o passado do MRR: o histórico mensal (`platform_mrr_history`) é gravado a cada abertura do painel desde a v1.7.0.
- Bloco **Atenção**: testes por vencer (7 dias), testes vencidos, pagamentos em atraso e clientes sem acesso há mais de 30 dias.
- Receita por plano; criação manual de grupo (com administrador já cadastrado); **gestão de planos** (preço, limites, módulos, teste, gateway).

## Gerenciar clientes
Tabela com responsável (e-mail e WhatsApp com link), plano, cadastro, vencimento, atletas/limite, situação e último acesso. Busca sem acento, filtros por situação e plano, ordenação, paginação e exportação CSV. Clientes excluídos ficam ocultos por padrão (filtro "Excluída").

## Página do cliente (`/super/clientes/[id]`)
| Aba | Conteúdo |
|---|---|
| Visão geral | Dados cadastrais, plano, utilização (barra de atletas) |
| Usuários e atletas | Só **contagens** e a equipe administrativa (nome, e-mail, último acesso); nomes de atletas não aparecem |
| Assinatura | Plano, valor, fim do teste, pago até, vínculo e último evento do Asaas |
| Configurações | Edição de nome, site, lema, cor, logo, rodapé, contato do responsável, **tipo de cliente** (grupo de futebol ou centro esportivo) e anotação interna |
| Atividades | Acessos por dia, avisos de vencimento enviados e alterações administrativas |

Ações no topo: **Modo espião**, **Suspender/Reativar**, **+7 dias de teste**, **Excluir** (ou **Restaurar** / **Excluir definitivamente** quando já excluído).

## Suspensão
Bloqueia o acesso imediatamente e **preserva todos os dados**. Registra motivo, data e quem suspendeu. O cliente vê uma tela amigável com o motivo e a orientação de falar com o suporte.

## Log de acessos (`/super/acessos`)
Quem abriu o sistema em cada dia (horário de Brasília), por grupo, com navegação por dia e busca. Alimentado por `log_access()` (uma vez por aba por dia).

## Comunicados em massa (`/super/comunicados`)
Para avisar os clientes sobre novidades, manutenções e recados gerais.
- **Canais:** e-mail (administradores ativos de cada grupo + o responsável cadastrado) e/ou **aviso dentro do painel** (administrador e diretoria; fica de 1 a 90 dias e cada pessoa pode dispensar o seu).
- **Público:** por situação do cliente (ativas, em teste, suspensas, canceladas) e por plano. A tela mostra ao vivo quantos grupos e e-mails recebem. Clientes **excluídos** e os que **pediram para não receber** (opção na aba Configurações do cliente) ficam de fora.
- **Antes de enviar:** botão **Enviar teste para mim** (só o seu e-mail) e confirmação com a contagem final.
- **Envio:** o banco guarda um instantâneo dos destinatários (`broadcast_recipients`); a rota `/api/super/comunicados/enviar` manda em lotes de 15 (pausa de 0,5 s entre e-mails para respeitar o limite do provedor) e a tela acompanha o progresso. Se a página for fechada, **Continuar envio** retoma de onde parou. Cada e-mail tem resultado individual; falhas podem ser **reenviadas**.
- **Imagem (opcional):** o dono anexa uma imagem PNG, JPG ou WebP. O navegador a reduz para 1200 px e a converte em JPG (e-mail leve e sem metadados, como a localização do celular) e a envia ao **bucket público `comunicados` do Supabase Storage** (máx. 2 MB; só o dono da plataforma grava). A imagem aparece no e-mail e no aviso do painel. O banco só aceita endereços desse bucket. Alguns leitores de e-mail pedem ao cliente para liberar a exibição de imagens.
- **E-mail:** texto digitado vira parágrafos, links https ficam clicáveis, nenhum HTML cru. Rodapé informa por que a pessoa recebe e como pedir a retirada; o *Reply-To* é o seu e-mail.
- **Histórico:** assunto, data, grupos, e-mails enviados/falhas e quantos dispensaram o aviso. Tabelas: `broadcasts`, `broadcast_orgs`, `broadcast_recipients`, `broadcast_dismissals`.
- **Limite do provedor:** planos gratuitos de e-mail têm cota diária; e-mails recusados ficam como falha e podem ser reenviados no dia seguinte.

## Funções do banco usadas (`sa_*`)
Todas começam validando `sa_guard()` (só dono). Lista completa e atualizada na seção "Funções do banco" desta documentação.
