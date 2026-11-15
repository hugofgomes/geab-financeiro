<!-- revisado: 1.18.0 -->
# Módulo Quadra Esportiva

Módulo para a gestão profissional de quadras, arenas e centros esportivos. Está sendo implantado **neste sistema** para depois ser **migrado para o Partidou** (`partidou.com.br`). Por isso foi construído de forma **portátil** (ver "Contrato de portabilidade").

## Andamento por fases
| Fase | Conteúdo | Situação |
|---|---|---|
| 1 | Estrutura: módulo no plano, menu, centro esportivo e quadras | **Entregue (v1.18.0)** |
| 2 | Agenda (dia, semana, mês), reservas avulsas, bloqueios, recorrência e conflitos | Pendente |
| 3 | Clientes, funcionários e permissões, lista de espera, histórico | Pendente |
| 4 | Financeiro: contas a receber, baixas, mensalistas | Pendente |
| 5 | Dashboard completo e relatórios (PDF e Excel) | Pendente |
| 6 | Página pública, busca de disponibilidade, solicitação de reserva e camada de partidas/vagas | Pendente |

No menu, os itens das fases pendentes aparecem desativados (ícone de relógio).

## Como funciona
- **Estabelecimento = organização.** Um centro esportivo é uma organização (tenant) com `organizations.kind = 'quadra'` e um plano que inclui o módulo `quadras`. O dono da plataforma define o tipo na aba Configurações do cliente e o módulo no plano.
- **Menu:** quem tem perfil no módulo vê o submenu **Quadra Esportiva** (Dashboard, Agenda de Quadras, Centro Esportivo, Reservas, Lista de Espera, Clientes, Funcionários, Financeiro, Relatórios, Configurações). Em organizações do tipo centro esportivo o menu do grupo de futebol (atletas, mensalidades etc.) fica oculto e a página inicial é o módulo.
- **Visual:** identidade do Partidou aplicada só ao módulo (classe `.quadra-theme`: verde-lima `#B9F344`, verde-escuro `#142C25`, grafite `#19221D`, branco gelo `#F6F8F4`).
- **Telas da Fase 1:** `/quadra` (Dashboard: indicadores do cadastro e primeiros passos) e `/quadra/centro` (abas Perfil, Endereço e Quadras). Os indicadores de reservas e faturamento chegam nas próximas fases; nada é exibido com dados inventados.

## Perfis do módulo
| Perfil | Como é definido | Pode (Fase 1) |
|---|---|---|
| **Administrador** | `profiles.role = 'admin'` do estabelecimento | Tudo: perfil do centro, endereço, quadras |
| **Gerente** | tabela `court_staff` | Cadastrar e editar quadras; consultar o centro |
| **Recepcionista** | `court_staff` | Consultar |
| **Financeiro** | `court_staff` | Consultar |

A função `court_role()` resolve o perfil e devolve nulo (sem acesso) quando o módulo não está no plano. Em modo espião o dono enxerga como administrador, somente leitura. As telas de equipe (convite, bloqueio, revogação) chegam na Fase 3.

## Banco de dados (Fase 1)
- `court_venues`: o centro (um por organização): nome fantasia, razão social, CPF/CNPJ **validado no banco**, descrição, logotipo, telefone, WhatsApp, e-mail, site, redes, endereço, localização (latitude e longitude) e fuso horário (padrão `America/Sao_Paulo`).
- `court_courts`: quadras (nome único por estabelecimento, modalidade, piso, cobertura, iluminação, capacidade, até 8 fotos, valor base por horário em centavos, ativa/inativa). Limite de **quadras ativas** pelo plano (`plans.max_courts`).
- `court_staff`: perfis da equipe (gerente, recepcionista, financeiro).
- Armazenamento: bucket público `quadras` (imagens até 2 MB, PNG/JPG/WebP); cada estabelecimento só grava na **própria pasta** (`<id-do-estabelecimento>/`) e só administrador ou gerente.
- Toda tabela usa `tenant_id` (preenchido pela sessão, nunca pelo navegador), RLS, bloqueio de escrita do modo espião e auditoria (`audit_log`). A exportação e a exclusão definitiva de clientes já incluem as tabelas `court_*`.

## Decisões que valem para as próximas fases
- **Fonte única de disponibilidade:** reservas e bloqueios ficarão na **mesma tabela**, com restrição de exclusão no banco (`btree_gist`) que impede dois registros ativos sobrepostos na mesma quadra. Reservas canceladas não bloqueiam; horários consecutivos são permitidos. Reserva do painel, reserva pública, bloqueio e reserva ligada a partida usarão a mesma regra.
- **Operações críticas** (criar, remarcar, cancelar, registrar pagamento) em funções SQL transacionais.
- **Financeiro:** valores em centavos; lançamentos e pagamentos nunca são apagados.
- **Fuso:** horários em UTC, exibidos no fuso do estabelecimento.

## Contrato de portabilidade (migração para o Partidou)
O módulo depende do sistema hospedeiro em **apenas quatro pontos**. No Partidou basta reimplementá-los:
1. **Isolamento por estabelecimento:** `tenant_id`, `resolve_tenant()` / `current_tenant()` (devolve o estabelecimento da sessão) e os gatilhos `tenant_guard()` e `tenant_ref_check()`.
2. **Perfis de usuário:** a tabela `profiles` (usuário, `role = 'admin'`, `active`, `tenant_id`) usada por `court_role()`.
3. **Módulos e limites por plano:** `plans.modules` (inclui `quadras`) e `plans.max_courts`.
4. **Infraestrutura comum:** auditoria (`audit()`), bloqueio do modo espião (`block_support_writes()`) e envio de e-mail.

Tudo o mais é do módulo: tabelas `court_*`, funções `court_*`, migrations `quadra_*` (arquivo `0035_quadra_fase1.sql` em diante), telas em `src/app/(admin)/quadra/`, hooks `use-court-role` e a classe de tema `.quadra-theme`.

## Pendências e riscos conhecidos
- Os fluxos do Partidou de **jogador buscar quadra, criar partida e completar vagas** não existem neste sistema (as partidas daqui pertencem a um grupo); serão uma camada mínima na Fase 6.
- Pix e gateways: somente preparação de estrutura; nada simulado. Avisos da lista de espera por WhatsApp: apenas links, sem envio automático.
