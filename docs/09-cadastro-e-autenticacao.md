<!-- revisado: 1.13.0 -->
# Cadastro e autenticação

A autenticação é do Supabase Auth (e-mail e senha). A criação de perfis e grupos é feita por um gatilho no banco (`handle_signup_form`, sobre `auth.users`), então vale mesmo que alguém chame a API de cadastro direto.

## Quatro portas de entrada
| Quem | Onde | O que acontece |
|---|---|---|
| **Cliente do SaaS** (novo grupo) | `/novo-grupo` (botão "Criar conta grátis" do site) | Informa nome do grupo, endereço, **nome completo, WhatsApp**, e-mail e senha. Depois de confirmar o e-mail, o grupo já existe em teste e a pessoa é a Administradora. Nome, e-mail e WhatsApp viram o **contato do cliente** no Painel do SaaS |
| **Atleta de um grupo** | `/cadastro?grupo=endereço` (ou no endereço do próprio grupo) | Formulário completo (nome, apelido, nascimento, WhatsApp, e-mail, senha, aceite LGPD). Gera uma **solicitação** que a administração aprova em Cadastros |
| **`/cadastro` sem grupo** | Endereço principal | Tela "Criar conta": criar o próprio grupo (teste grátis) **ou** informar o endereço do grupo para entrar como atleta |
| **Conta confirmada sem grupo** | `/cadastro/status` | A pessoa escolhe criar o grupo (pede WhatsApp) ou pedir entrada em um grupo; funções `create_my_org` e `request_join_group` |

Todos os campos são obrigatórios no primeiro cadastro (o aceite de mensagens pelo WhatsApp é o único opcional, por ser consentimento). O banco também exige nome completo e telefone ao criar um grupo.

## Confirmação de e-mail
Obrigatória. O link do e-mail abre `/auth/confirmar` (aceita os tipos `signup`, `email`, `invite` e `recovery`, inclusive o fluxo com `code`). Os e-mails saem pelo **SMTP do Supabase Auth configurado para a Resend** (remetente `geab@vendadigital.com`), com assuntos e textos em português.

## Recuperação de senha
`/recuperar` envia o link; `/redefinir-senha` define a nova senha. O login tem o atalho "Esqueci minha senha". As URLs de retorno permitidas (`uri_allow_list` do Supabase) incluem os dois domínios de produção.

## Acesso criado pelo administrador
Na ficha do atleta, "Criar acesso ao sistema" cria o login com senha provisória exibida uma vez (rota `/api/atletas/acesso`, com a chave de serviço no servidor). O atleta troca a senha na Área do Atleta.

## Troca de senha
Na Área do Atleta e em "Minha conta": exige a senha atual e aplica a nova (mínimo de 8 caracteres), com medidor de força.
