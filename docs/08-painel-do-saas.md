<!-- revisado: 1.13.0 -->
# Painel do SaaS (dono da plataforma)

Acesso: apenas contas em `platform_admins`. O menu mostra **Painel do SaaS**, **Log de acessos**, **Documentação**, **Site comercial** e **Demonstração**.

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
| Configurações | Edição de nome, site, lema, cor, logo, rodapé, contato do responsável e anotação interna |
| Atividades | Acessos por dia, avisos de vencimento enviados e alterações administrativas |

Ações no topo: **Modo espião**, **Suspender/Reativar**, **+7 dias de teste**, **Excluir** (ou **Restaurar** / **Excluir definitivamente** quando já excluído).

## Suspensão
Bloqueia o acesso imediatamente e **preserva todos os dados**. Registra motivo, data e quem suspendeu. O cliente vê uma tela amigável com o motivo e a orientação de falar com o suporte.

## Log de acessos (`/super/acessos`)
Quem abriu o sistema em cada dia (horário de Brasília), por grupo, com navegação por dia e busca. Alimentado por `log_access()` (uma vez por aba por dia).

## Funções do banco usadas (`sa_*`)
Todas começam validando `sa_guard()` (só dono). Lista completa e atualizada na seção "Funções do banco" desta documentação.
