/**
 * Texto próprio e PROVISÓRIO dos Termos de Uso e da Política de Privacidade (D-023 RN-16, RN-17,
 * D-11). Dados tipados para permitir o hash de guarda por versão e o teste por termo. Pendência:
 * revisão jurídica antes de produção; a troca por texto definitivo exige nova `VERSAO_TERMOS`.
 */
export type SecaoDeDocumento = {
  readonly id: string;
  readonly titulo: string;
  readonly paragrafos: readonly string[];
};

export type Documento = {
  readonly titulo: string;
  readonly secoes: readonly SecaoDeDocumento[];
};

export const AVISO_PROVISORIO =
  'Este texto é provisório, foi escrito para a fase inicial do produto e ainda não passou por revisão jurídica. Ele pode mudar, e cada mudança recebe uma nova versão.';

export const DOCUMENTOS: { readonly termos: Documento; readonly privacidade: Documento } = {
  termos: {
    titulo: 'Termos de Uso',
    secoes: [
      {
        id: 'quem-somos',
        titulo: 'Quem somos e o que fazemos',
        paragrafos: [
          'A Agenda Beleza é uma plataforma de agendamento online para salões de beleza. Cada salão usa a plataforma para divulgar seus serviços, horários e profissionais e para receber reservas.',
          'A plataforma organiza a agenda e envia mensagens sobre as reservas. O atendimento, o preço e a prestação do serviço são de responsabilidade do salão escolhido.',
        ],
      },
      {
        id: 'reservas',
        titulo: 'Reservas',
        paragrafos: [
          'Você reserva um ou mais serviços em um horário disponível, informando seu nome e seu número de WhatsApp. Não é preciso criar conta.',
          'A reserva fica confirmada quando a tela de confirmação é exibida. O salão pode remarcar ou cancelar a reserva e você será avisada pelo WhatsApp.',
          'Os valores mostrados são os do momento da reserva e o pagamento é combinado diretamente com o salão, no atendimento.',
        ],
      },
      {
        id: 'mensagens',
        titulo: 'Mensagens por WhatsApp',
        paragrafos: [
          'Ao reservar, você concorda em receber mensagens sobre a própria reserva: confirmação, remarcação e cancelamento. Não enviamos mensagens promocionais.',
          'O convite para avaliar o atendimento só é enviado se você marcar essa opção, que vem desmarcada.',
        ],
      },
      {
        id: 'uso-adequado',
        titulo: 'Uso adequado',
        paragrafos: [
          'Informe dados verdadeiros e que sejam seus ou de quem autorizou o uso. Não use a plataforma para fraudar reservas, sobrecarregar o sistema ou prejudicar outras pessoas.',
          'Avaliações devem descrever a experiência real, sem ofensas, dados pessoais de terceiros ou conteúdo ilegal. A plataforma pode retirar avaliações que descumpram estes termos.',
        ],
      },
      {
        id: 'responsabilidades',
        titulo: 'Responsabilidades e mudanças',
        paragrafos: [
          'Fazemos o possível para manter a plataforma disponível, mas ela pode ficar indisponível por manutenção ou falhas fora do nosso controle.',
          'Podemos alterar estes termos. A versão em vigor é a indicada no topo desta página, e o que você aceitou fica registrado com a versão aceita.',
        ],
      },
    ],
  },
  privacidade: {
    titulo: 'Política de Privacidade',
    secoes: [
      {
        id: 'dados-coletados',
        titulo: 'Quais dados coletamos',
        paragrafos: [
          'Para a reserva, coletamos seu nome e seu número de WhatsApp. Guardamos também as reservas feitas, os serviços escolhidos e o registro do que você aceitou (finalidade, data, versão do texto e origem).',
          'Não pedimos nem guardamos dados de cartão. Não há conta de cliente.',
        ],
      },
      {
        id: 'finalidades',
        titulo: 'Para que usamos os dados',
        paragrafos: [
          'Usamos seus dados para registrar e administrar sua reserva e para enviar por WhatsApp as mensagens de confirmação, remarcação e cancelamento.',
          'O salão escolhido decide a finalidade do atendimento e acessa os dados das reservas dele. A Agenda Beleza opera o sistema que guarda essas informações. Seus dados não são compartilhados com outros salões.',
        ],
      },
      {
        id: 'avaliacoes',
        titulo: 'Avaliações',
        paragrafos: [
          'Só quem teve uma reserva concluída pode avaliar, por um link individual enviado depois do atendimento, e somente se tiver aceitado o convite.',
          'Quando publicada, a avaliação mostra a nota, o comentário, seu primeiro nome e a inicial do sobrenome. Nenhum outro dado seu aparece.',
          'A avaliação deixa de ser publicada em três situações: se a reserva passar a ser marcada como "não compareceu"; se você pedir a anonimização dos seus dados; ou por moderação da plataforma.',
          'Qualquer visitante pode denunciar uma avaliação. O gestor do salão não edita nem apaga avaliações; a decisão de retirar é da plataforma.',
        ],
      },
      {
        id: 'seus-direitos',
        titulo: 'Seus direitos e como pedir a anonimização ou a remoção',
        paragrafos: [
          'Você pode pedir acesso, correção, anonimização ou remoção dos seus dados. Peça pelo contato informado na página do salão ou pelo canal de contato da Agenda Beleza.',
          'A anonimização apaga seu nome e seu telefone e mantém o histórico das reservas sem identificar você. Você também pode pedir para deixar de receber o convite de avaliação.',
        ],
      },
      {
        id: 'guarda-seguranca',
        titulo: 'Guarda e segurança',
        paragrafos: [
          'Os dados ficam em banco de dados com acesso restrito à equipe do salão ao qual a reserva pertence. Guardamos os dados enquanto forem necessários para as finalidades acima ou para cumprir obrigações legais.',
        ],
      },
    ],
  },
};
