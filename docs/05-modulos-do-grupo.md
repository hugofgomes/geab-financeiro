<!-- revisado: 1.13.0 -->
# Módulos do painel do grupo

Telas usadas por Administrador (edita) e Diretoria (só consulta). O menu lateral é recolhível e funciona em celular.

## Início (`/`)
Painel com indicadores do mês (previsto x recebido, pendências), gráfico de mensalidades, aniversariantes e artilharia.

## Atletas (`/atletas`)
Cadastro completo (nome, apelido, nascimento, contatos, valor da mensalidade, situação ativo/inativo). O limite de atletas ativos do plano é imposto pelo banco. O administrador pode **criar acesso ao sistema** para o atleta (login com senha provisória exibida uma única vez, rota `/api/atletas/acesso`).

## Mensalidades (`/mensalidades`)
Cobranças por competência (mês). Situações: pendente, parcial, pago, atrasado, em conferência. Registro de pagamentos, geração de Pix (automático quando configurado) e envio de confirmações por WhatsApp/e-mail (conforme o plano e a configuração do servidor). Nesta tela também fica a configuração do **Pix manual** (código copia e cola do grupo), usado para gerar o valor exato da mensalidade quando não há Pix automático.

## Caixa (`/caixa`) e Extrato (`/extrato`)
Entradas (mensalidades e outras receitas), despesas (descrição, categoria, local e valor) e saldo. O extrato lista os lançamentos para conferência.

## Jogos (`/jogos`), Escalação (`/escalacao`) e Gols ao vivo (`/ao-vivo`)
- Agenda de jogos com placar, equipes (padrão "Equipe Azul" x "Equipe Branco") e local.
- Escalação por jogo (equipes A, B e reserva) e card pronto para compartilhar no WhatsApp (com rodapé do grupo).
- Gols ao vivo: o administrador registra gols durante a partida; a artilharia é calculada por temporada.
- Alterações de jogos avisam a Área do Atleta, que se atualiza.

## Cadastros (`/cadastros`)
Solicitações de entrada de atletas (formulário público). O administrador **aprova** — ligando a pessoa a um atleta já cadastrado ou criando um atleta novo — ou **recusa**.

## Usuários e privilégios (`/usuarios`)
Lista os logins do grupo, altera o nível (Administrador, Diretoria, Atleta), ativa/desativa e vincula usuário a atleta.

## Importar planilha (`/importar`)
Importa atletas, mensalidades e entradas de uma planilha do Google **publicada na web** (cada aba é lida como CSV pela rota `/api/planilha`, que só aceita endereços do Google). Módulo `importar` do plano.

## Meu grupo (`/grupo`)
Identidade do grupo: nome, logo, cor, site, lema e rodapé do card da escalação.

## Assinatura (`/assinatura`)
Situação do teste/assinatura, escolha do plano e ida ao pagamento (Asaas). Também é a tela que o grupo bloqueado vê, com a mensagem adequada (teste terminou, pagamento pendente, acesso suspenso, grupo encerrado).

## Minha conta (`/conta`)
Troca de senha e dados do próprio usuário.
