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
**Antes de criar a 2ª organização**, as rotas de servidor (webhooks OpenPix/BTG, `btg.ts`) precisam informar o `tenant_id`; até lá a omissão falha de propósito.

## O que NÃO existe ainda
Importação da planilha, conciliação por extrato OFX/CSV, Pix com identificador por cobrança (depende de provedor),
WhatsApp Business API (depende de aprovação da Meta), fluxos n8n, Docker/VPS, backups automáticos.

## Regras garantidas pelo banco
Pagamento acima do valor da mensalidade é recusado; o mesmo identificador bancário nunca baixa duas vezes;
status da mensalidade é recalculado por trigger; só o administrador escreve; o atleta só enxerga os próprios dados.
