<!-- revisado: 1.13.0 -->
# Como esta documentação se mantém atualizada

## O que atualiza sozinho
A cada build (`npm run build`, que é o que o Coolify executa em cada deploy) o script `tools/build-docs.mjs` lê o código e regenera as seções automáticas:
- versão atual, data e histórico das últimas versões;
- lista de **migrations** (com o resumo do cabeçalho de cada uma);
- **tabelas** e **funções do banco** (com a migration de origem);
- **páginas** e **rotas de API** (com o nível de acesso das páginas e os métodos das APIs);
- **variáveis de ambiente** usadas pelo aplicativo (somente os nomes).

Ou seja: criou uma página, rota, tabela, função ou migration, ela aparece aqui na próxima publicação, sem ninguém editar nada.

## O que precisa de revisão humana
- Os **capítulos** em `docs/NN-nome.md` explicam o "porquê" e o "como". Cada um tem a marca `<!-- revisado: x.y.z -->`; quando a versão do sistema avança além disso, a tela mostra um aviso de que o capítulo pode estar desatualizado, até alguém revisar e atualizar a marca.
- As **descrições** de páginas, APIs e variáveis ficam em `docs/descricoes.json`. Itens novos sem descrição aparecem marcados com "sem descrição" e saem como aviso no build.

## Regra de ouro para quem altera o sistema
Toda entrega que mude comportamento: atualizar o capítulo correspondente, a marca `revisado` e `docs/descricoes.json` (se houver item novo), junto com o histórico de versões.

## Quem vê
Somente o dono da plataforma. A documentação não é servida como arquivo público: a rota `/api/docs` valida a sessão e confirma no banco que a conta é dona da plataforma antes de devolver qualquer conteúdo.
