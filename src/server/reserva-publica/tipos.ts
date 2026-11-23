// Contratos client-safe da página pública do salão e do fluxo de reserva (D-026 §3; D-050 §3.10: um
// profissional e um horário por serviço). Sem imports de runtime de servidor: componentes cliente e a casca
// da ação os importam.
import type { ErrosReserva } from '@/server/reservas/tipos';
import type { ErrosConsentimento } from '@/server/consentimento/tipos';

/** Códigos fechados do aviso na URL (`?aviso=`): nunca texto livre. */
export const CODIGOS_AVISO = [
  'horario_indisponivel',
  'servico_indisponivel',
  'profissional_indisponivel',
  'sem_selecao',
] as const;
export type CodigoAviso = (typeof CODIGOS_AVISO)[number];

/** Textos fixos dos avisos (os que dependem do serviço/horário estão em `MENSAGENS_PASSO`). */
export const MENSAGENS_AVISO: Record<CodigoAviso, string> = {
  horario_indisponivel: 'Este horário não está mais disponível. Escolha outro horário.',
  servico_indisponivel: 'Algum dos serviços escolhidos não está mais disponível. Escolha novamente.',
  profissional_indisponivel: 'O profissional escolhido não está mais disponível. Escolha novamente.',
  sem_selecao: 'Escolha um horário para continuar.',
};

/**
 * Textos do passo por serviço e da reescolha (web-design §5.3, §5.6, §5.7). Recebem nomes e horas JÁ
 * formatados (`src/lib/format.ts` no chamador); nunca formatam nada aqui.
 */
export const MENSAGENS_PASSO = {
  semSelecao: (servico: string) => `Escolha um horário para ${servico}.`,
  horarioPerdido: (hora: string, servico: string) => `O horário das ${hora} de ${servico} não está mais disponível. Escolha outro.`,
  vazioCalendarioTitulo: (servico: string) => `Nenhum horário para ${servico} neste dia.`,
  vazioCalendarioTexto: 'Escolha outro dia ou altere os serviços.',
  vazioConflitoTitulo: (servico: string) => `Os horários de ${servico} neste dia coincidem com os serviços que você já escolheu.`,
  vazioConflitoTexto: 'Altere o horário de outro serviço acima ou escolha outro dia.',
  profissionalSemHorario: 'Sem horários livres neste dia.',
  indicador: (n: number, total: number) => `Serviço ${n} de ${total}`,
  continuar: 'Continuar',
  continuarParaDados: 'Continuar para seus dados',
  diaComHorarios: 'Um dia aparece disponível quando cada serviço tem ao menos um horário livre nele.',
  /** Reescolha, um item: "O horário das 10:00 de Hidratação com Bia acabou de ser reservado. …". */
  reescolhaUm: (hora: string, servico: string, profissional: string | null) =>
    `O horário das ${hora} de ${servico}${profissional === null ? '' : ` com ${profissional}`} acabou de ser reservado. ` +
    'Escolha outro horário para este serviço. Os outros serviços e os seus dados continuam aqui.',
  /** Reescolha, vários: `lista` já vem como "Hidratação (10:00) e Manicure (15:00)" (`formatarLista`). */
  reescolhaVarios: (lista: string) =>
    `Os horários de ${lista} acabaram de ser reservados. Escolha novos horários para eles. ` +
    'Os outros serviços e os seus dados continuam aqui.',
  reescolhaTituloUm: (servico: string) => `Escolha outro horário para ${servico}`,
  reescolhaTituloVarios: 'Escolha outros horários',
  reescolhaBloco: (servico: string) => `Novo horário para ${servico}`,
  reescolhaSemHorarioTitulo: (servico: string) => `Não há mais horários para ${servico} neste dia.`,
  reescolhaSemHorarioTexto: 'Você pode escolher outro dia ou seguir sem este serviço. Nos dois casos será preciso informar seus dados de novo.',
  /** Nenhum item caiu de fato (o horário voltou a ficar livre): passo de dados com aviso genérico. */
  reescolhaSemQueda: 'Não foi possível concluir a reserva agora. Confira os horários e tente novamente.',
} as const;

export const MENSAGENS_RESERVA_PUBLICA = {
  indisponivelTitulo: 'Agendamento indisponível',
  indisponivelTexto: 'Este salão não está recebendo reservas pela internet no momento. Você pode consultar o perfil e entrar em contato.',
  recusada: 'Não foi possível concluir a reserva. Tente novamente.',
  generico: 'Revise os campos indicados e tente novamente.',
} as const;

/** Item escolhido, já resolvido (nomes, snapshot atual do serviço e fim), para o roteiro e o resumo. */
export type ItemEscolhido = {
  /** Posição em `s` (ordem de escolha). */
  indice: number;
  servicoId: string;
  servicoNome: string;
  profissionalId: string;
  profissionalNome: string;
  /** Instantes UTC (ISO); a UI formata no fuso do salão. */
  inicioIso: string;
  fimIso: string;
  precoCentavos: number;
  duracaoMin: number;
};

export type ResumoConfirmacao = {
  fuso: string;
  /** Data civil local do salão, 'AAAA-MM-DD'. */
  data: string;
  /** Por início (RN-6). */
  itens: {
    servicoNome: string;
    profissionalNome: string;
    inicioIso: string;
    fimIso: string;
    precoCentavos: number;
    duracaoMin: number;
  }[];
  /** Soma dos itens não cancelados (RN-35); na criação todos estão confirmados. */
  totalCentavos: number;
};

export type ErrosReservaPublica = ErrosReserva & ErrosConsentimento;

/** Item pedido pela página: `inicio` em ISO UTC canônico (o mesmo valor do rádio, sem o prefixo). */
export type ItemPedidoPublico = { servicoId: string; profissionalId: string; inicio: string };

export type EntradaReservaPublica = {
  slug: string;
  /** `s` da URL, na ordem de escolha. */
  servicoIds: string[];
  /** Um por serviço, na MESMA ordem de `servicoIds` (`itens[k].servicoId === servicoIds[k]`). */
  itens: ItemPedidoPublico[];
  nome: unknown;
  telefone: unknown;
  aceites: unknown;
  chaveRequisicao: string;
  /** IP já extraído por `extrairIp` (D-027); nunca o cabeçalho cru. */
  ip: string;
  /** Token do widget Turnstile (`cf-turnstile-response`); null se ausente. */
  tokenHumano: string | null;
};

export type ResultadoReservaPublica =
  | { resultado: 'confirmada'; resumo: ResumoConfirmacao; repetida: boolean }
  /** Redireciona (303) ao passo indicado; `indice` só com `passo: 'servico'`. */
  | { resultado: 'voltar'; passo: 'servicos' | 'servico'; indice?: number; aviso: CodigoAviso }
  /**
   * Horário de algum item tomado (D-036/CA-10): a casca NÃO redireciona; monta a reescolha com
   * `reescolhaDosItens`. `itens` = índices conhecidos (vazio quando o 23P01 não identifica o item).
   */
  | { resultado: 'reescolher'; itens: number[] }
  | { resultado: 'invalido'; erros: ErrosReservaPublica }
  | { resultado: 'indisponivel' }
  | { resultado: 'slug_mudou'; slugAtual: string }
  | { resultado: 'recusado'; mensagem: string }
  /** Limite de IP ou de número excedido (D-027); a mensagem não revela qual. */
  | { resultado: 'limitado'; mensagem: string };

/** Visão (view-model) de cada passo, já resolvida no servidor. Datas civis como 'AAAA-MM-DD'. */
export type ServicoDaSelecao = { id: string; nome: string; precoCentavos: number; duracaoMin: number };
/** Serviços escolhidos na ordem de `s`; total = soma dos preços. */
export type Selecao = { servicos: ServicoDaSelecao[]; precoTotalCentavos: number };

/** Estado da URL para montar links e campos ocultos (`montarHref`, `camposOcultos`). */
export type ConsultaDaUrl = {
  s?: readonly string[];
  data?: string;
  de?: string;
  /** Por índice em `s`: `<profissionalId>_<isoUTC>`; null/ausente = não escolhido. */
  h?: readonly (string | null)[];
  f?: string;
  alterar?: 'servicos' | number;
  enviado?: number;
  aviso?: CodigoAviso;
};

export type ProfissionalComHorarios = {
  id: string;
  nome: string;
  /** Inícios (ISO UTC) no dia, em ordem; vazio = "Sem horários livres neste dia." */
  horarios: string[];
};

export type VisaoDoPasso =
  /** Consulta de horários limitada por IP (D-027): nenhum horário foi calculado. */
  | { passo: 'limitado' }
  /** `marcados`: serviços a deixar marcados ("Alterar serviços"). */
  | { passo: 'servicos'; marcados: string[]; aviso: CodigoAviso | null }
  | {
      passo: 'data';
      s: string[];
      selecao: Selecao;
      de: string;
      /** Dia oferecido se CADA serviço tem ao menos um horário nele (DA-2). */
      dias: { data: string; temHorarios: boolean }[];
      anterior: string | null;
      proxima: string | null;
      aviso: CodigoAviso | null;
    }
  | {
      passo: 'servico';
      s: string[];
      data: string;
      fuso: string;
      selecao: Selecao;
      /** Índice do serviço em escolha (0-based) e o total (para "Serviço k+1 de N"). */
      indice: number;
      total: number;
      servico: ServicoDaSelecao;
      /** Itens dos OUTROS serviços já escolhidos, por início (paradas "escolhida", com "Alterar"). */
      escolhidos: ItemEscolhido[];
      /** Índices dos outros serviços ainda sem horário, na ordem de `s` (paradas "pendente"). */
      pendentes: number[];
      /** Profissionais ATIVOS vinculados ao serviço, ordem nome, id, já filtrados por `filtro`. */
      profissionais: ProfissionalComHorarios[];
      /** Opções do filtro (todos os elegíveis); a UI só mostra o filtro com 2+. */
      opcoesDeFiltro: { id: string; nome: string }[];
      filtro: string | null;
      /** Valor do rádio a pré-selecionar (`<profissionalId>_<iso>`), só se ainda oferecido. */
      preSelecionado: string | null;
      /** true quando veio de "Alterar" (meta "alterando" no roteiro). */
      alterando: boolean;
      /** true quando continuar leva ao passo de dados (botão "Continuar para seus dados"). */
      proximoEhDados: boolean;
      /** Nenhum profissional com horário no dia: por calendário ou por conflito com os escolhidos (C3). */
      vazio: 'calendario' | 'conflito' | null;
      aviso: CodigoAviso | null;
      /** Com `aviso: 'horario_indisponivel'`: o horário perdido (ISO) para `MENSAGENS_PASSO.horarioPerdido`. */
      horarioPerdidoIso: string | null;
      /** Estado da URL deste passo (sem `f`, `alterar`, `enviado`, `aviso`). */
      consulta: ConsultaDaUrl;
    }
  | {
      passo: 'dados';
      s: string[];
      data: string;
      fuso: string;
      selecao: Selecao;
      /** Todos os itens, por início (RN-6). */
      itens: ItemEscolhido[];
      totalCentavos: number;
      consulta: ConsultaDaUrl;
    };

/** Item que caiu, com as alternativas do mesmo dia (reescolha, web-design §5.6). */
export type ItemDaReescolha = {
  indice: number;
  servicoId: string;
  servicoNome: string;
  /** Horário que deixou de estar livre (ISO) e com quem era (null se o profissional não está mais ativo). */
  horarioAnteriorIso: string;
  profissionalAnteriorNome: string | null;
  /** Elegíveis do serviço (ordem nome, id) com os horários que ainda cabem com os itens mantidos. */
  profissionais: ProfissionalComHorarios[];
  /** false = item reaberto (`reabrir`) que continua livre: `horarioAnteriorIso` é a escolha atual. */
  caiu: boolean;
  /** Valor do rádio a pré-selecionar (item reaberto ainda livre); null quando caiu. */
  preSelecionado: string | null;
};

export type ReescolhaDosItens =
  | {
      resultado: 'reescolher';
      fuso: string;
      data: string;
      /** Itens mantidos, por início (paradas "escolhida", sem "Alterar"). */
      mantidos: ItemEscolhido[];
      /** Itens que caíram, por índice (paradas "destaque" e um bloco de grades por item). */
      itens: ItemDaReescolha[];
      /** Estado da URL (para "Escolher outro dia" e "Seguir sem X"; sem dado pessoal). */
      consulta: ConsultaDaUrl;
    }
  /** Nenhum item caiu de fato: a UI mostra o passo de dados com `MENSAGENS_PASSO.reescolhaSemQueda`. */
  | { resultado: 'sem_queda' }
  /** Consulta de horários limitada por IP. */
  | { resultado: 'limitado' };
