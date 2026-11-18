<!-- revisado: 1.25.1 -->
# Migração para outro servidor (VPS)

Roteiro para trocar o VPS onde o Coolify roda (por exemplo, para outro plano da Hostinger) **sem perder dados e com poucos minutos de indisponibilidade**.

## O que muda e o que não muda
- **Não muda:** banco, login (Auth) e arquivos (Storage) ficam no **Supabase**, fora do VPS. O código fica no GitHub.
- **Muda:** o servidor que executa o contêiner do aplicativo, o Coolify (com suas variáveis e domínios) e o IP para onde o DNS aponta.

## Requisitos do novo VPS
- Ubuntu 22.04 ou 24.04, **mínimo 2 vCPU e 4 GB de RAM** (o build do Next.js estoura memória em máquinas menores) e **2 a 4 GB de swap**.
- Portas 22, 80, 443 e 8000 (painel do Coolify) liberadas no firewall.

## Passo a passo
1. **Backup de segurança:** `node --env-file=.env.deploy scripts/backup-supabase.mjs`. O banco não muda de lugar, mas é a regra antes de qualquer troca.
2. **Anotar as variáveis de ambiente** do Coolify antigo (aplicação → Environment Variables), incluindo as marcadas como *Build Variable* (`NEXT_PUBLIC_*`). Os nomes estão na seção "Variáveis de ambiente" desta documentação. Guarde os valores somente em local privado, nunca no GitHub nem em conversa.
3. **Swap no novo VPS:** `fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` e adicionar `/swapfile none swap sw 0 0` em `/etc/fstab`.
4. **Instalar o Coolify** no novo VPS (comando oficial em coolify.io/docs) e criar o usuário administrador.
5. **Conectar o GitHub** (Sources) e criar a aplicação: repositório `hugofgomes/geab-financeiro`, branch `main`, *Build Pack* **Dockerfile**, porta **3000**.
6. **Cadastrar as variáveis.** As `NEXT_PUBLIC_*` precisam estar como variáveis de **build**. `ASAAS_API_KEY` começa com `$`: marcar como **literal**.
7. **Gerar um token** em Keys & Tokens do novo Coolify e atualizar `COOLIFY_URL`, `COOLIFY_TOKEN` e `COOLIFY_APP_UUID` no `.env.deploy`.
8. **Primeiro deploy** com o domínio provisório do Coolify (sslip.io) e testar: login, painel e uma tela de cada módulo.
9. **Baixar o TTL do DNS** (para 300 s) um dia antes, nos registros `geab` e `futebol` do domínio `vendadigital.com`.
10. **Trocar o DNS:** apontar os registros A para o IP do novo VPS e cadastrar os domínios na aplicação do novo Coolify; o SSL (Let's Encrypt) é emitido sozinho.
11. **Conferir:** site, login, webhook do Asaas (a URL não muda se o domínio for o mesmo), e-mails e a rotina diária (`CRON_SECRET`).
12. **Manter o VPS antigo ligado por alguns dias** como plano de volta (basta reapontar o DNS). Depois desligar e **revogar o token do Coolify antigo**.

## Pontos de atenção
- Se o domínio mudar, atualizar `APP_URL`, `SITE_URL` e as URLs de webhook (Asaas, BTG, WhatsApp).
- O Supabase não precisa de alteração: ele aceita conexões de qualquer IP.
- Durante a troca de DNS, parte dos usuários ainda vê o servidor antigo. Como ambos usam o mesmo banco, nada se perde.
- Não migrar o banco para o próprio VPS: perderia Auth, Storage e backups gerenciados.

## Se algo der errado
Reapontar o DNS para o IP antigo. Como o banco é o mesmo, não há dados a recuperar.
