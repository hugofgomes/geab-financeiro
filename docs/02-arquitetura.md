<!-- revisado: 1.27.0 -->
# Arquitetura

## Camadas
1. **Navegador**: páginas React. Conversa com o Supabase diretamente (com a chave pública *anon* e a sessão da pessoa) e com as rotas `/api/*` do próprio sistema.
2. **Aplicativo Next.js** (`src/app`): páginas por perfil, rotas de API, *middleware* de proteção e rotinas do servidor.
3. **Supabase**: banco PostgreSQL com funções (RPC), gatilhos e **RLS (regras de acesso por linha)**; Autenticação (e-mail e senha, recuperação, convite).
4. **Serviços externos**: Asaas (cobrança), Resend/SMTP (e-mails), BTG e OpenPix (Pix automático), WhatsApp Cloud API (mensagens).

## Princípio central: o banco é a barreira de verdade
As telas escondem o que a pessoa não pode usar, mas **quem decide o acesso é o banco** (RLS, funções `SECURITY DEFINER` e gatilhos). Mesmo que alguém altere o navegador, as regras do banco continuam valendo. Por isso a lógica sensível (limites de plano, bloqueio de grupo, somente leitura do modo espião, exclusão) está em SQL.

## Estrutura do código
| Pasta | Conteúdo |
|---|---|
| `src/app/(admin)` | Painel do administrador/diretoria e do dono da plataforma (`/super`) |
| `src/app/atleta` | Área do atleta |
| `src/app/(site)` | Site de divulgação e demonstração |
| `src/app/api` | Rotas de servidor (cobrança, webhooks, e-mail, WhatsApp, Pix, rotina diária, documentação) |
| `src/components` | Componentes (menu, rodapé, faixas de aviso, mockups do site etc.) |
| `src/lib` | Regras compartilhadas (perfis, formatação, Supabase, Pix, tenant) |
| `src/data/changelog.json` | Histórico de versões (fonte única) |
| `supabase/migrations` | Evolução do banco, numerada e em ordem |
| `supabase/tests` | Testes do banco (rodam em um PostgreSQL embutido) |
| `scripts` | Ferramentas de operação (migrations, backup, configuração do Coolify/Asaas) |
| `tools` | Verificações de build (histórico de versões, geração desta documentação) |
| `docs` | Capítulos escritos à mão desta documentação |

## Proteção de rotas (middleware)
O *middleware* (`src/middleware.ts`) roda antes de cada página: exige login, encaminha cada perfil para a sua área (administrador/diretoria para o painel, atleta para `/atleta`) e **bloqueia grupos sem acesso** (teste vencido, suspenso, cancelado ou excluído), levando-os à tela de assinatura. Ficam fora dele apenas `/api/versao`, `/api/webhooks/*` e `/api/cron/*` (que têm autenticação própria por segredo) e arquivos estáticos.

## App instalável (PWA)
O sistema pode ser instalado no celular como aplicativo (manifesto, ícones e *service worker* que não guarda dados de usuário). Detalhes no capítulo "Aplicativo para celular".

## Versão e atualização no navegador
A versão exibida no rodapé vem do `package.json` e precisa ter entrada no histórico (`src/data/changelog.json`); o build recusa versões sem histórico. A rota `/api/versao` devolve o identificador do build para o navegador avisar sobre novas versões.

## Padrão visual (design system)
Identidade discreta: fundo cinza muito claro, azul-marinho como cor principal, vermelho só para erro e atraso, tipografia Inter, bordas finas e cantos de 7 a 10 px (token `--radius` em `globals.css`). Sombras só onde há sobreposição (menus, janelas). Os componentes base ficam em `src/components/ui`; indicadores do dashboard seguem o padrão compacto (texto pequeno, número em destaque, sem ícone decorativo). Menu lateral com página ativa em destaque suave e opção de recolher. Mudanças visuais globais devem partir dos tokens, nunca de classes soltas em cada tela.

Padrões aplicados em todas as telas: título de página `text-xl font-semibold`; tabelas com cabeçalho em cinza discreto e células de `py-2.5`; cartões sem sombra (borda fina); indicadores compactos (rótulo pequeno, número em destaque, sem caixa de ícone); sem gradientes nas telas internas. Páginas públicas (site comercial, demonstração e busca de quadras) têm identidade própria e não seguem este padrão.
