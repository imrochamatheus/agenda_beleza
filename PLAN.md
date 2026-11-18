# Agenda Beleza

## Objetivo

Construir o **Agenda Beleza**, uma plataforma web responsiva de gestão e agendamento para salões de beleza no Brasil. O produto deve atender vários salões, mantendo contas, equipe, clientes e reservas separados por estabelecimento.

Use [AppBarber](https://appbarber.com.br/) e [AppBeleza](https://www.appbeleza.com.br/funcionalidades) como referências de **funcionalidades e fluxos**. Crie identidade visual, textos e código próprios. O resultado esperado é uma primeira versão funcional, executável localmente e preparada para publicação em VPS com Docker.

Idioma da interface: pt-BR. Moeda: BRL.

## Escopo da primeira versão

### Perfis e acesso

- **Gestor:** cria o salão, contrata a assinatura, configura serviços, profissionais, jornadas e bloqueios; consulta clientes e administra todos os agendamentos. Há **um gestor por salão** nesta versão. O gestor pode também atender: nesse caso, possui um perfil de profissional vinculado, com agenda própria.
- **Profissional:** recebe convite por e-mail e define a própria senha. Vê sua agenda, cria reservas manuais na própria agenda e pode remarcar, cancelar e marcar o status dos próprios atendimentos. Gerencia **apenas os próprios bloqueios** (folga, compromisso pessoal); a jornada semanal só o gestor edita.
- **Cliente:** agenda sem criar conta, pela página pública do salão. Informa nome e número de WhatsApp.
- **Administrador da plataforma (super admin):** opera a plataforma por um painel interno. Não se cadastra pelo fluxo público; a conta é criada por seed ou variável de ambiente e exige segundo fator (TOTP).

Gestor, profissional e super admin entram com **e-mail e senha**, com sessões seguras (cookie httpOnly) e permissões por perfil. O gestor confirma o e-mail no cadastro. Recuperação de senha e convite de profissional usam e-mail transacional.

Cada salão possui uma URL pública identificada por um slug, gerado a partir do nome e editável pelo gestor. Um slug antigo redireciona para o atual. Todas as consultas e alterações autenticadas devem aplicar o escopo do salão no servidor; ocultar dados na interface não é suficiente.

### Serviços e profissionais

- Serviço: nome, preço fixo, duração e situação (ativo ou inativo).
- O gestor indica quais profissionais executam cada serviço. Preço e duração são os mesmos para todos os profissionais.
- Profissionais e serviços são desativados, nunca apagados, para preservar o histórico.

### Agenda e atendimento

- O gestor define a jornada semanal de cada profissional, com pausas.
- Bloqueios existem em dois níveis: por profissional e para o salão inteiro (feriado, reforma).
- Fluxo público, nesta ordem: a cliente escolhe **um ou mais serviços**; depois escolhe **um profissional**, entre os que executam todos os serviços escolhidos; depois escolhe o horário; por fim informa nome, WhatsApp e consentimento. O sistema soma as durações e preços e apresenta apenas horários em que todo o atendimento, executado em sequência, cabe na disponibilidade.
- Regras de horário configuráveis por salão, com estes valores iniciais: grade de 15 minutos, antecedência mínima de 2 horas, janela máxima de 60 dias e intervalo de 0 minuto entre atendimentos.
- A reserva feita pela página pública entra **confirmada** imediatamente, ocupa o horário e dispara a confirmação por WhatsApp.
- Um agendamento registra o preço e a duração vigentes de cada serviço no momento da reserva, preservando o histórico quando o cadastro do serviço mudar.
- Status do agendamento: `confirmado`, `cancelado`, `concluído` e `não compareceu`. A equipe marca concluído ou não compareceu após o horário.
- A equipe pode criar reservas manualmente, remarcar e cancelar. A equipe pode fazer **encaixe** fora da jornada ou em horário bloqueado, desde que confirme um aviso explícito. Clientes solicitam mudanças diretamente ao salão; não há portal de cliente nesta versão.
- Nenhuma reserva ativa pode se sobrepor a outra do mesmo profissional, inclusive em encaixes e em tentativas concorrentes. A proteção final fica no banco de dados: constraint de exclusão do PostgreSQL (`btree_gist`, intervalo `tstzrange` por profissional, apenas para status ativos), criada por migração SQL. A interface também valida.
- Datas são gravadas em UTC. A agenda e os horários públicos usam o fuso configurado para cada salão. O padrão inicial é `America/Sao_Paulo`.

### Proteção da página pública

A página pública aceita qualquer número sem verificação. Para reduzir abuso e mensagens enviadas a terceiros:

- limite de requisições por IP e por número;
- máximo de 3 reservas futuras por número no mesmo salão;
- captcha (Cloudflare Turnstile), com adaptador simulado para execução local.

### Clientes e privacidade (LGPD)

Manter cadastro básico por salão: nome, WhatsApp e histórico de agendamentos. Aceitar apenas números brasileiros, normalizados no formato E.164. A cliente é identificada pelo par salão + número; uma nova reserva com o mesmo número atualiza o nome. O mesmo número pode existir em salões diferentes sem compartilhar informações.

O gestor pode corrigir dados de clientes. Excluir uma cliente significa **anonimizá-la**: nome e WhatsApp são removidos, e as reservas passam a exibir "cliente removida", preservando a agenda.

Incluir páginas de Termos de Uso e Política de Privacidade (texto provisório). Registrar o consentimento da cliente com data e versão do texto aceito.

### Assinatura

Cobrar **R$ 79 mensais por salão**, sem limite de profissionais, com **30 dias grátis**. O gestor informa o meio de pagamento ao iniciar o teste. Integrar a [API de Assinaturas do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/overview), que documenta cobranças recorrentes e período gratuito em [planos de assinatura](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/subscription-management).

O cadastro pode criar uma conta provisória, mas o teste só começa quando a autorização da assinatura for confirmada pelo Mercado Pago. Nunca considerar o retorno do navegador como prova de pagamento: consultar o provedor e processar webhooks com validação de origem e idempotência (registro de cada evento recebido). Vincular cada assinatura de forma inequívoca ao salão.

Após falha de cobrança, conceder três dias para regularização, contados a partir da primeira falha notificada pelo Mercado Pago. Depois disso, o salão fica **suspenso**:

- a página pública mostra "agendamento indisponível";
- os dados continuam consultáveis;
- criar e remarcar reservas e alterar configurações operacionais ficam bloqueados;
- **exceção:** a equipe pode cancelar reservas futuras, e a cliente recebe o aviso de cancelamento.

Reativar o acesso quando o pagamento for regularizado. Permitir ao gestor consultar o estado da assinatura e cancelá-la. Uma assinatura cancelada conserva acesso até o fim do período já concedido; cancelamento durante o teste mantém acesso até o fim do teste, sem cobrança.

### Mensagens pelo WhatsApp

Enviar mensagens automáticas pelo **número central da plataforma**, usando a [WhatsApp Business Platform oficial](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview) e três modelos de mensagem aprovados:

1. **Confirmação:** após salvar a reserva, identificando salão, serviços, profissional, data e horário.
2. **Remarcação:** quando a equipe altera data, horário, profissional ou serviços.
3. **Cancelamento:** quando a equipe cancela a reserva.

Solicitar consentimento para as mensagens no formulário público.

O envio ocorre depois da gravação da reserva, por uma fila no PostgreSQL (por exemplo, `pg-boss`) processada por um worker separado. Registrar cada tentativa, aplicar novas tentativas com intervalo crescente e usar chave de idempotência por reserva + tipo de evento, para nunca duplicar mensagem nem reserva. Falha no WhatsApp não cancela nem altera o agendamento. Não incluir lembretes ou mensagens promocionais nesta versão.

O custo por mensagem cobrado pela Meta fica com a plataforma; registrar esse custo como risco a acompanhar.

### Painel do administrador da plataforma

- Listar salões com situação da assinatura.
- Ver e editar dados de um salão.
- Suspender e reativar um salão manualmente.
- Estender o período de teste.
- Ver a assinatura e os eventos recebidos do Mercado Pago.
- Ver a fila de mensagens e reenviar mensagens com falha.

Toda ação do super admin fica registrada em log de auditoria (quem, quando, o quê, valores anteriores e novos).

## Interface

Criar, no mínimo:

- Página inicial curta com proposta do produto, preço e acesso ao cadastro.
- Cadastro do gestor e do salão, confirmação de e-mail e fluxo de assinatura.
- Login, recuperação de senha e aceite de convite de profissional.
- Painel do gestor com agenda, serviços, profissionais, jornadas, bloqueios, clientes, configurações do salão (incluindo regras de horário) e assinatura.
- Agenda individual do profissional, com gestão dos próprios bloqueios.
- Página pública do salão com escolha de serviços, profissional e horário, formulário de contato e tela de confirmação.
- Páginas de Termos de Uso e Política de Privacidade.
- Painel do administrador da plataforma.
- Estados claros para horário indisponível, encaixe fora da jornada, assinatura pendente ou suspensa, salão indisponível na página pública, erro de pagamento e falha de envio de mensagem.

A interface deve funcionar bem em celular e computador, ser acessível por teclado e usar a marca provisória **Agenda Beleza**.

Direção visual: **elegante e quente**. Tons terrosos e nude, tipografia serifada nos títulos e sem serifa no corpo, bastante espaço em branco. Evitar o rosa genérico comum em produtos do segmento.

## Direção técnica

Inicie um projeto novo com **Next.js, TypeScript, PostgreSQL e Prisma**. Use componentes reutilizáveis, validação no servidor, sessões seguras e permissões por perfil.

Entidades centrais sugeridas: salão, usuário, profissional, serviço, vínculo serviço-profissional, jornada, bloqueio (de profissional e de salão), cliente, consentimento, agendamento, itens do agendamento, assinatura, evento de webhook, fila de mensagens, convite, token de recuperação de senha e log de auditoria.

Separe as integrações de Mercado Pago, WhatsApp, e-mail transacional e captcha da lógica de negócio. Como ainda não há credenciais, entregue adaptadores reais configuráveis por variáveis de ambiente e adaptadores simulados para execução e testes locais. Não armazene dados de cartão.

Inclua migrações, arquivo de exemplo das variáveis de ambiente, `docker-compose` com aplicação, worker e PostgreSQL, e dados de demonstração para **dois salões distintos** e uma conta de super admin.

Testes: Vitest para unidade e integração com PostgreSQL real; Playwright para o fluxo público em tela de celular.

## Fora da primeira versão

Caixa, estoque, comissões, relatórios financeiros, fidelidade, pagamento dos serviços pela cliente, aplicativos Android/iOS, agendamento por WhatsApp, lembretes, mensagens promocionais, conta de cliente, múltiplos gestores por salão e preço ou duração diferentes por profissional. Evite criar telas ou estruturas extensas para essas funções agora.

## Critérios de aceite

1. Dois salões conseguem se cadastrar e configurar serviços e profissionais sem acessar dados um do outro.
2. Uma cliente consegue reservar vários serviços consecutivos com um profissional, sem conta, pelo celular; só aparecem profissionais que executam todos os serviços escolhidos.
3. Horários fora da jornada, bloqueados ou ocupados não são oferecidos na página pública; duas tentativas simultâneas não geram conflito, e encaixes da equipe também não geram sobreposição.
4. Gestor e profissional veem apenas as agendas permitidas e conseguem alterar, cancelar e marcar status dos atendimentos autorizados.
5. O fluxo de 30 dias grátis, cobrança mensal, falha, carência, suspensão, regularização e cancelamento funciona com o adaptador local; webhooks repetidos não duplicam efeitos.
6. Confirmação, remarcação e cancelamento por WhatsApp são registrados, enviados pelo adaptador configurado e podem ser repetidos após falha sem duplicar mensagem nem reserva.
7. A cliente anonimizada some das buscas, e o histórico da agenda continua íntegro.
8. Recuperação de senha e convite de profissional funcionam com o adaptador de e-mail simulado.
9. O super admin estende um teste, suspende e reativa um salão e reenvia uma mensagem; cada ação aparece no log de auditoria.
10. A página pública aplica limite de requisições, limite de reservas por número e captcha (simulado localmente).
11. O projeto inicia localmente a partir das instruções do README, com testes automatizados para isolamento entre salões, concorrência da agenda, permissões e eventos de assinatura.

Implemente o fluxo de ponta a ponta e documente, ao final, os comandos para executar e testar o projeto. Indique separadamente os dados necessários para ativar os serviços reais: credenciais do Mercado Pago; conta, número e três modelos aprovados da WhatsApp Business Platform; credenciais do provedor de e-mail transacional; chaves do Cloudflare Turnstile. A publicação na internet fica para uma etapa posterior.
