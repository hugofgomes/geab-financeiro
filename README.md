# GEAB Futebol · Financeiro

Controle de mensalidades, pagamentos e caixa. Next.js + Supabase (Postgres, Auth, RLS).

## Como rodar
1. Crie um projeto Supabase **só para o GEAB** (não reutilize o de outro sistema).
2. No SQL Editor, rode `supabase/migrations/0001_schema.sql`.
3. Em Authentication → Users, crie o seu usuário e rode `supabase/bootstrap-admin.sql` (com o seu e-mail).
4. Copie `.env.example` para `.env.local` e preencha a URL e a chave **publishable/anon**. Nunca use a chave de serviço no front-end.
5. `npm install && npm run dev` e abra http://localhost:3000.

Para dar acesso a um atleta: crie o usuário no Supabase e rode `supabase/link-athlete.sql`.

## O que está pronto (MVP)
Atletas, geração de mensalidades, baixa manual (parcial/total), status (pendente, parcial, pago, atrasado, em conferência),
histórico individual, caixa (despesas e saldo), dashboard, área do atleta, mensagem de agradecimento pelo pagamento da mensalidade, aberta no WhatsApp por link (`wa.me`) com
histórico de aberturas, auditoria, RLS (admin × atleta).

## Gols ao vivo e Escalação
- **Gols ao vivo** (`/ao-vivo`): marca gols durante o jogo (placar + artilharia), com desfazer e correção. Sem migration.
- **Escalação** (`/escalacao`): monta Azul × Branco (arrastar ou botões, goleiros, reservas, número), salva por jogo, confirma, duplica
  e gera o card PNG (1080×1350 ou 1080×1080) para WhatsApp. Exige rodar `supabase/migrations/0015_lineups.sql`.

## Multi-tenant (SaaS) — etapa 1
`supabase/migrations/0016_multitenant.sql`: organizações, `tenant_id` em todas as tabelas, RLS por organização, gatilhos de proteção
(escrita e referências entre organizações) e funções do banco filtradas. Os dados atuais viram a organização `geab`.
Teste de isolamento (Postgres local descartável, sem tocar na produção): `npm i --no-save embedded-postgres pg && node supabase/tests/run-tests.mjs`.

## Multi-tenant — etapa 2 (grupos)
`0017_organizations_app.sql`: identidade do grupo (nome, logotipo https, cor, site, lema), criação de grupo no cadastro (`/novo-grupo`,
14 dias de teste), `org_public` (login/cadastro), `update_organization`, suspensão (grupo suspenso perde o acesso) e slugs reservados.
- Telas: `/novo-grupo` (público), `/grupo` (Meu grupo). Nome/logotipo do grupo aparecem no painel, login, cadastro, portal e card da escalação.
- Endereço por grupo: defina `NEXT_PUBLIC_BASE_DOMAIN` (ex.: `plataforma.com.br`) e aponte `*.plataforma.com.br` para o app; `slug.plataforma.com.br` abre o grupo.
- **Integrações globais** (Pix BTG/OpenPix, WhatsApp, e-mail) usam credenciais do servidor e ficam restritas ao grupo dono (`PLATFORM_ORG_SLUG`, padrão `geab`);
  os demais usam o Pix manual até haver credencial por grupo (etapa de assinaturas/integrações). Webhooks já identificam o grupo pela cobrança.

## O que NÃO existe ainda
Importação da planilha, conciliação por extrato OFX/CSV, Pix com identificador por cobrança (depende de provedor),
WhatsApp Business API (depende de aprovação da Meta), fluxos n8n, Docker/VPS, backups automáticos.

## Regras garantidas pelo banco
Pagamento acima do valor da mensalidade é recusado; o mesmo identificador bancário nunca baixa duas vezes;
status da mensalidade é recalculado por trigger; só o administrador escreve; o atleta só enxerga os próprios dados.
