<!-- revisado: 1.25.0 -->
# Operação, deploy e manutenção

## Hospedagem
VPS com **Coolify** (Docker). O build usa o `Dockerfile` do projeto (Node 22). A cada publicação o Coolify clona a branch `main` do GitHub, gera a imagem (rodando `npm run build`, que valida o histórico de versões e **regenera esta documentação**) e troca o contêiner.

Variáveis de ambiente de produção ficam no Coolify. Variáveis `NEXT_PUBLIC_*` são gravadas no código **na hora do build**. Os nomes de todas as variáveis usadas pelo aplicativo estão na seção "Variáveis de ambiente" desta documentação (os valores nunca são exibidos).

## Fluxo de uma entrega
1. Alterar o código em uma branch.
2. Se houver mudança no banco: nova migration numerada em `supabase/migrations` (somente adiciona; com instruções de reversão no fim) e testes em `supabase/tests/run-tests.mjs`.
3. Subir a versão no `package.json` e registrar a entrada **no topo** de `src/data/changelog.json` (novidades, melhorias, correções, com data).
4. Atualizar os capítulos de `docs/` afetados (e a marca `revisado`), e `docs/descricoes.json` se houver página, API ou variável nova.
5. Rodar tipos, lint, build e testes; commitar.
6. **Backup do banco → aplicar migrations → merge na `main` e push → deploy no Coolify** (nesta ordem; a migration antes do código novo).

## Ferramentas (`scripts/`)
| Comando | Função |
|---|---|
| `node --env-file=.env.deploy scripts/migrate.mjs` | Aplica migrations pendentes (`--status` lista; `--baseline NNNN` marca como aplicadas) usando a tabela `public.schema_migrations` |
| `node --env-file=.env.deploy scripts/backup-supabase.mjs` | Backup completo em `backups/AAAAMMDD-HHMM` (pasta ignorada pelo Git; contém dados pessoais) |
| `node --env-file=.env.deploy scripts/coolify-setup.mjs [--deploy]` | Cria/atualiza variáveis do Asaas no Coolify e dispara o deploy |
| `node --env-file=.env.deploy scripts/asaas-setup.mjs` | Cria o webhook no Asaas |

`.env.deploy` (ignorado pelo Git) guarda `DATABASE_URL` (conexão do banco), `COOLIFY_URL`, `COOLIFY_TOKEN` (permissões read, write e deploy) e `COOLIFY_APP_UUID`. Use `node --env-file=` (não `source`, pois o token contém `|`).

## Rotina diária
Tarefa agendada no Coolify (`avisos-de-vencimento`, `0 12 * * *` = 9h de Brasília) chama `/api/cron/vencimentos` dentro do contêiner com o `CRON_SECRET`. Não depende do token do Coolify depois de criada.

## Testes
`node supabase/tests/run-tests.mjs` sobe um PostgreSQL embutido, aplica **todas** as migrations em ordem e executa centenas de verificações (isolamento entre grupos, limites, cobrança, exclusão, modo espião, cadastro etc.). Deve passar 100% antes de qualquer publicação.

## Segurança operacional
- Credenciais só em `.env.deploy` local ou nas variáveis do Coolify; nunca no chat, no Git ou em arquivos versionados.
- Ao terminar um trabalho: esvaziar `COOLIFY_TOKEN` e `DATABASE_URL` do `.env.deploy`, **revogar o token no Coolify** e **trocar a senha do banco** no Supabase.
- **Não revogar** a chave do Asaas, a da Resend nem a `SUPABASE_SERVICE_ROLE_KEY`: a produção depende delas. Para trocá-las, crie a nova, atualize Coolify e Supabase, faça o deploy e só então apague a antiga.
- Guardar uma cópia segura dos backups e apagar os desnecessários.

## Domínio app.partidou.com.br (mesma instalação)
O aplicativo é o mesmo (um só Supabase e um só contêiner); o domínio é apenas mais um endereço. Passos (feitos fora do código, uma vez):
1. **DNS** (onde `partidou.com.br` está registrado): registro `A` de `app` apontando para o IP da VPS do Coolify (o mesmo dos domínios `vendadigital.com`).
2. **Coolify** → aplicação → Configuration → Domains: acrescentar `https://app.partidou.com.br` à lista (separada por vírgula, mantendo os atuais) e fazer o deploy; o certificado HTTPS é emitido automaticamente.
3. **Supabase** → Authentication → URL Configuration: incluir `https://app.partidou.com.br/**` em *Redirect URLs* (necessário para convite de funcionários, recuperação de senha e login). Se o *Site URL* for trocado para o Partidou, ajustar também `SITE_URL` no Coolify.
4. **Aplicativo:** nada a alterar no código; links de retorno usam o endereço público da requisição (`publicOrigin`). Se a página inicial do Partidou for outra, `app.` fica reservado ao sistema.
Observação: a página pública das quadras (`/quadras/<nome>`) é da Fase 6 e ainda não existe.

## Marca por instalação (Partidou × GEAB)
O mesmo código serve as duas marcas. Na aplicação do Partidou, defina a variável de **build** `NEXT_PUBLIC_BRAND=partidou`: as variáveis CSS da classe `.brand-partidou` (em `globals.css`) trocam as cores do sistema inteiro para verde-escuro `#142C25`, lima `#B9F344`, branco gelo `#F6F8F4` e grafite `#19221D`; título, manifesto e cor do app passam a ser do Partidou, e visitantes na raiz vão para `/quadras`. Sem a variável (GEAB), nada muda. Como é variável de build, exige novo deploy. Os ícones do app (`public/pwa`) e o logotipo ainda são os do GEAB.

## Problemas conhecidos e dicas
- Deploy com a VPS sem memória: se o build travar, repetir o deploy ou aumentar a memória/swap.
- Imagens do site em `public/site` precisam das extensões liberadas no `matcher` do middleware (já inclui svg, png, jpg, jpeg, webp, gif, ico).
- Chave do Asaas começa com `$`: marcar a variável como literal no Coolify.
