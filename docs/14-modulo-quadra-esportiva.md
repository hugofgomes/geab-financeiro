<!-- revisado: 1.19.0 -->
# Módulo Quadra Esportiva

Módulo para a gestão profissional de quadras, arenas e centros esportivos. Está sendo implantado **neste sistema** para depois ser **migrado para o Partidou** (`partidou.com.br`). Por isso foi construído de forma **portátil** (ver "Contrato de portabilidade").

## Andamento por fases
| Fase | Conteúdo | Situação |
|---|---|---|
| 1 | Estrutura: módulo no plano, menu, centro esportivo e quadras | **Entregue (v1.18.0)** |
| 2 | Agenda (dia, semana, mês), reservas avulsas, bloqueios, recorrência e conflitos | **Entregue (v1.19.0)** |
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

## Agenda e reservas (Fase 2)
**Telas:** `/quadra/agenda` (visões Dia, Semana e Mês), `/quadra/reservas` (lista completa com filtros) e `/quadra/configuracoes` (funcionamento, preços e regras).
- **Agenda:** grade de horários com blocos coloridos — **laranja** reserva avulsa, **verde** mensalista, **roxo** mensalista com professor, **cinza** manutenção, torneios e bloqueios; borda tracejada = pendente; bolinha vermelha, amarela ou verde = pagamento em aberto, parcial ou pago. Filtros por quadra, modalidade, categoria e situação. Clicar num horário livre abre a criação; clicar num bloco abre os detalhes (confirmar, concluir, não compareceu, editar, remarcar, cancelar, histórico e link de WhatsApp). Horários fechados ficam sombreados; a visão do dia mostra quantos horários livres restam por quadra. Atualiza sozinha a cada minuto e ao voltar para a aba. No celular a visão padrão é a lista do dia, por quadra.
- **Reservas recorrentes:** semanal, quinzenal ou mensal (mesmo dia do mês), por quantidade (até 104) ou data final (até 2 anos). Cada ocorrência é uma reserva própria (presença, cancelamento e pagamento individuais). Editar ou cancelar permite escolher **somente esta** ou **esta e as próximas**. Datas em conflito são listadas ao final, nunca ignoradas em silêncio.
- **Bloqueios:** em uma ou mais quadras, por manutenção, torneio ou outro motivo; podem ficar fora do horário de funcionamento. Só administrador e gerente.
- **Configurações (administrador):** janelas de funcionamento por dia (várias por dia criam intervalos indisponíveis; a quadra pode ter horários próprios), regras de preço **por hora** por dia, faixa de horário, quadra e tipo (vale a regra mais específica e, depois, a de maior prioridade; sem regra vale o valor base da quadra) e regras da agenda (grade de 30 ou 60 minutos, duração mínima, antecedência mínima e máxima para a página pública da Fase 6, janela de cancelamento sem custo e percentual de cancelamento tardio, aplicado no Financeiro da Fase 4).

**Regras garantidas no banco (`0036_quadra_fase2.sql`):**
- **Conflito:** a restrição `court_bookings_no_overlap` (extensão `btree_gist`) impede duas reservas ou bloqueios ativos sobrepostos na mesma quadra, inclusive com **duas pessoas reservando ao mesmo tempo** (testado). Reservas canceladas não bloqueiam; horários colados (20h–21h e 21h–22h) são permitidos.
- **Escrita só por funções** transacionais (`court_booking_create`, `court_block_create`, `court_booking_update`, `court_booking_reschedule`, `court_booking_cancel`, `court_series_create`), que validam permissão, horário de funcionamento, grade e duração mínima, valor e conflito no servidor, devolvendo mensagens claras ("Horário indisponível: já existe R-000001 · João"). Nem o administrador escreve direto na tabela.
- **Fora do funcionamento:** só bloqueios podem ficar fora. **Passado:** só administrador e gerente lançam reservas no passado.
- **Situação:** pendente → confirmada → concluída ou não compareceu (só depois do início); cancelar é uma ação própria, que guarda motivo e marca **cancelamento tardio** quando faltam menos horas que o limite configurado. Reserva cancelada nunca é apagada.
- **Código sequencial** por estabelecimento (`R-000001`), **fuso** do centro (horários em UTC) e **histórico** de cada reserva (quem fez o quê, a partir da auditoria).
- **Perfis:** administrador, gerente e recepcionista criam e alteram reservas; só administrador e gerente criam bloqueios; só o administrador altera configurações; o financeiro consulta.

Tabelas: `court_bookings` (reservas e bloqueios), `court_series`, `court_hours`, `court_price_rules` e `court_counters`. Nesta fase o cliente da reserva é guardado como nome e telefone digitados; o cadastro de clientes (Fase 3) vai vincular as reservas.

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
