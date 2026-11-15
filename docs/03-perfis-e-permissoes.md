<!-- revisado: 1.13.0 -->
# Perfis e permissões

## Os quatro níveis
| Nível | Onde fica no banco | Acesso |
|---|---|---|
| **Dono da plataforma** | tabela `platform_admins` | `/super` (Painel do SaaS, log de acessos, esta documentação). Vê **agregados** de cada cliente, nunca nomes de atletas nem pagamentos (exceto na exportação de dados e no modo espião, ambos registrados) |
| **Administrador** | `profiles.role = 'admin'` | Tudo do próprio grupo: atletas, mensalidades, caixa, extrato, jogos, escalação, cadastros, usuários, importação, assinatura, "Meu grupo" |
| **Diretoria** | `profiles.role = 'diretoria'` | Consulta todas as áreas de operação, **sem alterar nada** e sem acessar usuários, importação, "Meu grupo", gols ao vivo e assinatura |
| **Atleta** | `profiles.role = 'atleta'`, ligado a um atleta | Só a própria conta, mensalidades, jogos e desempenho |

As áreas exclusivas do administrador estão em `src/lib/roles.ts` (lista `ADMIN_ONLY`); a tela esconde, mas **o banco recusa** de qualquer forma.

## Como o acesso é decidido
- `is_admin()`, `is_staff()` e `current_tenant()` são as funções que as regras de acesso consultam.
- `current_tenant()` devolve o grupo da pessoa **somente se o grupo estiver utilizável** (ativo, ou em teste dentro do prazo). Grupo bloqueado não lê nenhuma linha.
- O dono da plataforma **não** enxerga dados dos grupos pelas tabelas: usa funções `sa_*` específicas (`sa_guard()` valida que é dono).

## Limites por plano (impostos pelo banco)
- **Atletas ativos**: gatilho `enforce_athlete_limit` barra novos atletas acima do limite do plano.
- **Administradores**: gatilho `enforce_admin_limit` barra novos administradores (ou promoções) acima do limite. A Diretoria não conta.
- **Módulos**: cada plano liga/desliga importação de planilha, gols ao vivo, Pix automático e WhatsApp/e-mail; as rotas do servidor consultam `my_modules()` e recusam o que o plano não inclui.

## Regras de proteção
- Um grupo nunca fica sem administrador ativo (`guard_last_admin`), exceto na exclusão definitiva do grupo inteiro.
- O administrador não pode se rebaixar nem se desativar.
- O dono da plataforma não pode excluir (nem entrar em modo espião no) próprio grupo.
