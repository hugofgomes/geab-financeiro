<!-- revisado: 1.17.0 -->
# Visão geral

## O que é o sistema
Plataforma SaaS (software por assinatura) para **gestão de grupos de futebol amador**: cadastro de atletas, mensalidades e caixa, jogos, escalações, gols e artilharia, com uma área própria para cada atleta. Nasceu como o sistema interno do **GEAB Futebol** e hoje atende **vários grupos (clientes) na mesma instalação**, cada um com os seus dados isolados.

## Quem usa
| Perfil | Quem é | O que faz |
|---|---|---|
| **Dono da plataforma** (Super Admin) | O proprietário do SaaS | Gerencia clientes, planos, assinaturas, suspensões e exclusões; acessa o Painel do SaaS e esta documentação |
| **Administrador** | Quem criou o grupo (ou foi promovido) | Gerencia tudo do próprio grupo |
| **Diretoria** | Dirigentes do grupo | Consulta tudo do grupo, sem alterar nada |
| **Atleta** | Jogador do grupo | Vê só os próprios dados, jogos e mensalidades |

## Visão do produto
- **Site de divulgação** (`/site`): tema esportivo escuro (estádio à noite, verde `#39FF14`, fontes Sora e Inter). Seções: início, funcionalidades, jogos e escalação, financeiro, área do atleta, experiência mobile, planos (lidos do banco) e conversão final. Todos os botões levam aos fluxos reais (`/novo-grupo`, `/demo`, `/login`). Tem SEO (título, descrição, Open Graph, dados estruturados JSON-LD, `robots.txt` e `sitemap.xml`), imagem `/site/estadio.webp` no topo e rodapé com versão, **Política de privacidade** (`/privacidade`) e **Termos de uso** (`/termos`). As telas exibidas são ilustrativas, com dados fictícios.
- **Demonstração** (`/demo`): versão navegável com dados fictícios, sem cadastro (mantém o tema claro).
- **Teste gratuito**: todo grupo novo nasce em teste, com os dias definidos no plano de teste (hoje 10), sem cartão.
- **Assinatura**: ao fim do teste o grupo precisa assinar (Pix, boleto ou cartão pelo Asaas) para continuar.

## Endereços
- Produção: `geab.vendadigital.com` e `futebol.vendadigital.com` (mesma instalação). **`app.partidou.com.br`** é o endereço do Partidou/Quadra Esportiva, na mesma instalação (ver "Operação, deploy e manutenção": como ativar o domínio).
- Cada grupo pode ter endereço próprio no formato `grupo.dominio-base` quando `NEXT_PUBLIC_BASE_DOMAIN` está configurada; sem ela, o grupo é identificado pelo parâmetro `?grupo=` no cadastro de atleta.

## Tecnologias
Next.js (App Router) e React no servidor e no navegador, Tailwind CSS para o visual, Supabase (PostgreSQL, Autenticação e regras de acesso por linha), hospedagem em VPS com Coolify (Docker). Detalhes no capítulo de arquitetura.
