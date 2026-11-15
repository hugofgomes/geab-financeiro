<!-- revisado: 1.14.0 -->
# Aplicativo para celular (iOS e Android)

## Situação atual: app instalável (PWA)
O sistema pode ser instalado no celular como aplicativo, **sem passar pelas lojas**. Público-alvo: o **administrador** (e a Diretoria).

| Plataforma | Como instalar |
|---|---|
| **Android (Chrome)** | A faixa "Instale o app no celular" tem o botão **Instalar**; ou menu do Chrome → *Instalar app* |
| **iPhone / iPad (Safari)** | **Compartilhar → Adicionar à Tela de Início** (a faixa mostra a instrução) |

O app abre em tela cheia, com o ícone do GEAB, e tem atalhos por pressão longa no ícone: **Mensalidades**, **Jogos** e **Atletas**. A faixa de instalação aparece só em celular, some depois de instalar ou dispensar, e não aparece dentro do app já instalado.

## Como funciona (arquivos)
- `src/app/manifest.ts`: manifesto (nome, cores, ícones, atalhos, modo `standalone`), servido em `/manifest.webmanifest`.
- `public/pwa/`: ícones 192, 512 e *maskable* (com margem de segurança para Android).
- `public/sw.js`: *service worker*. **Nunca guarda páginas, respostas de API nem dados do Supabase** (dados de quem está logado não podem ficar no aparelho nem aparecer para outra pessoa). Guarda apenas arquivos estáticos públicos e a página `/offline`.
- `src/app/offline/page.tsx`: mostrada quando não há conexão.
- `src/components/pwa.tsx`: registro do service worker (só em produção) e a faixa de instalação.
- O *middleware* deixa `/offline`, `/manifest.webmanifest` e `/sw.js` públicos.
- Em iPhone com entalhe, o cabeçalho respeita a área segura (`safe-area-inset-top`).

## Atualizações
O app é o próprio site: cada deploy atualiza o aplicativo, sem baixar nada. O aviso de nova versão (`/api/versao`) continua valendo.

## Limites do PWA
- Não aparece na App Store nem na Play Store.
- No iPhone, notificações push só funcionam com o app instalado e iOS 16.4 ou mais novo (ainda **não implementadas**).
- O app exige internet: offline só mostra a página de "Sem conexão".

## Próxima etapa (opcional): publicar nas lojas
Empacotar o mesmo sistema com **Capacitor** (casca nativa que carrega o site):
1. Contas de desenvolvedor: Apple (US$ 99/ano) e Google Play (US$ 25, uma vez). O app iOS é compilado em um Mac com Xcode.
2. A Apple recusa apps que sejam só o site numa casca; incluir recursos nativos reais (notificações push de jogo e mensalidade, biometria).
3. Regra da Apple para cobrança: o app **não pode levar a um pagamento externo** para contratar o serviço. No app, ocultar a tela de assinatura e manter a contratação só pelo site (Asaas).
4. Prazo estimado: 1 a 3 semanas, incluindo a revisão das lojas.
Não recomendado: reescrever em React Native ou Flutter (refaz todas as telas e duplica a manutenção).
