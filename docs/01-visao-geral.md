<!-- revisado: 1.13.0 -->
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
- **Site de divulgação** (`/site`): apresenta o produto, os planos (vindos do banco) e leva ao cadastro de cliente.
- **Demonstração** (`/demo`): versão navegável com dados fictícios, sem cadastro.
- **Teste gratuito**: todo grupo novo nasce em teste, com os dias definidos no plano de teste (hoje 10), sem cartão.
- **Assinatura**: ao fim do teste o grupo precisa assinar (Pix, boleto ou cartão pelo Asaas) para continuar.

## Endereços
- Produção: `geab.vendadigital.com` e `futebol.vendadigital.com` (mesma instalação).
- Cada grupo pode ter endereço próprio no formato `grupo.dominio-base` quando `NEXT_PUBLIC_BASE_DOMAIN` está configurada; sem ela, o grupo é identificado pelo parâmetro `?grupo=` no cadastro de atleta.

## Tecnologias
Next.js (App Router) e React no servidor e no navegador, Tailwind CSS para o visual, Supabase (PostgreSQL, Autenticação e regras de acesso por linha), hospedagem em VPS com Coolify (Docker). Detalhes no capítulo de arquitetura.
