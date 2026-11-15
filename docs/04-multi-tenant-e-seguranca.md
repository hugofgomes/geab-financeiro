<!-- revisado: 1.13.0 -->
# Multi-tenant e segurança

## Isolamento entre clientes
Cada cliente é uma **organização** (tabela `organizations`). Todas as tabelas de dados têm a coluna `tenant_id` e regras de acesso que exigem `tenant_id = current_tenant()`. Gatilhos (`tenant_ref_check`) impedem ligar registros de grupos diferentes (por exemplo, uma cobrança de um grupo a um atleta de outro). Os testes automáticos tentam justamente furar esse isolamento.

## Situações do grupo
| Situação | Acesso | Como chega |
|---|---|---|
| `teste` | Sim, até o fim do teste | Cadastro de novo grupo |
| `ativa` | Sim | Pagamento confirmado ou ativação manual |
| `suspensa` | Não | Pagamento vencido (motivo "inadimplência") ou suspensão manual |
| `cancelada` | Não | Assinatura cancelada no Asaas ou manualmente |
| `excluida` | Não | Exclusão lógica pelo dono (recuperável até o fim do prazo) |

`org_usable(status, fim_do_teste)` é a regra única de "pode acessar".

## Auditoria
Mudanças relevantes entram em `audit_log` **com o `tenant_id` do grupo**: operações do dono (prefixo `SA_`), criação de grupo, exportações, início/fim de modo espião. O administrador do grupo pode consultar a auditoria do próprio grupo no banco (ainda não há uma tela dedicada), inclusive os acessos de suporte.

## Modo espião (suporte somente leitura)
- Entrada: página do cliente → **Modo espião**, com **motivo obrigatório** e duração de 5 a 240 minutos.
- Efeito: `support_sessions` faz `current_tenant()` devolver o grupo visitado; um gatilho (`a_support_readonly`) em **todas** as tabelas de dados recusa qualquer escrita; rotas do servidor que agem como administrador ficam fechadas.
- Visível: faixa amarela fixa "Modo espião" com botão de saída; início e fim ficam na auditoria do cliente e na aba Atividades da página dele no Painel do SaaS.
- O cadastro de novo grupo avisa que a equipe pode acessar a conta, somente leitura e com registro.

## Exclusão de clientes
1. **Exclusão lógica**: exige motivo, prazo de recuperação (7 a 365 dias, padrão 30) e a digitação do nome do grupo. O acesso é bloqueado e **nenhum dado é apagado**. Pode ser restaurada.
2. **Exportação**: JSON com todos os dados do grupo (exceto credenciais), registrada na auditoria.
3. **Exclusão definitiva**: só depois do prazo, digitando o nome de novo. Apaga **somente** as linhas daquele grupo e os logins dele, e deixa um registro em `platform_purges`.

## Credenciais e segredos
- Chaves de serviço (`SUPABASE_SERVICE_ROLE_KEY`), Asaas, SMTP e `CRON_SECRET` existem **apenas** como variáveis do servidor (Coolify). Nenhuma vai para o navegador nem para o Git.
- O arquivo local `.env.deploy` (ignorado pelo Git) guarda temporariamente o token do Coolify e a conexão do banco; o procedimento é esvaziá-lo e revogar os acessos ao terminar (ver capítulo de operação).
- Webhooks e rotina diária só aceitam chamadas com o segredo correto (comparação em tempo constante).

## Dados pessoais (LGPD)
Atletas informam nome, nascimento, WhatsApp e e-mail com aceite expresso; o consentimento de mensagens pelo WhatsApp é opcional. Backups e exportações contêm dados pessoais: guardar em local seguro e apagar o que não for necessário.
