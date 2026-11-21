// Contratos client-safe da página pública do salão e do fluxo de reserva (D-026 §3). Sem imports de
// runtime de servidor: componentes cliente e a casca da ação os importam.
import type { ErrosReserva } from '@/server/reservas/tipos';
import type { ErrosConsentimento } from '@/server/consentimento/tipos';

/** Códigos fechados do aviso na URL (`?aviso=`): nunca texto livre. */
export const CODIGOS_AVISO = [
  'horario_indisponivel',
  'servico_indisponivel',
  'profissional_indisponivel',
  'sem_profissional',
] as const;
export type CodigoAviso = (typeof CODIGOS_AVISO)[number];

export const MENSAGENS_AVISO: Record<CodigoAviso, string> = {
  horario_indisponivel: 'Este horário não está mais disponível. Escolha outro horário.',
  servico_indisponivel: 'Algum dos serviços escolhidos não está mais disponível. Escolha novamente.',
  profissional_indisponivel: 'O profissional escolhido não está mais disponível. Escolha novamente.',
  sem_profissional: 'Nenhum profissional realiza todos os serviços escolhidos. Escolha outra combinação.',
};

export const MENSAGENS_RESERVA_PUBLICA = {
  indisponivelTitulo: 'Agendamento indisponível',
  indisponivelTexto: 'Este salão não está recebendo reservas pela internet no momento. Você pode consultar o perfil e entrar em contato.',
  recusada: 'Não foi possível concluir a reserva. Tente novamente.',
  generico: 'Revise os campos indicados e tente novamente.',
} as const;

export type ResumoConfirmacao = {
  servicos: { nome: string; precoCentavos: number; duracaoMin: number }[];
  profissionalNome: string;
  /** Instante UTC (ISO); a UI formata no fuso do salão. */
  inicioIso: string;
  fuso: string;
  totalCentavos: number;
  duracaoTotalMin: number;
};

export type PassoDoFluxo = 'servicos' | 'profissional' | 'horario';

export type ErrosReservaPublica = ErrosReserva & ErrosConsentimento;

export type EntradaReservaPublica = {
  slug: string;
  servicoIds: string[];
  profissionalId: string;
  /** ISO UTC. */
  inicio: string;
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
  | { resultado: 'voltar'; passo: PassoDoFluxo; aviso: CodigoAviso }
  | { resultado: 'invalido'; erros: ErrosReservaPublica }
  | { resultado: 'indisponivel' }
  | { resultado: 'slug_mudou'; slugAtual: string }
  | { resultado: 'recusado'; mensagem: string }
  /** Limite de IP ou de número excedido (D-027); a mensagem não revela qual. */
  | { resultado: 'limitado'; mensagem: string };

/** Visão (view-model) de cada passo, já resolvida no servidor. Datas civis como 'AAAA-MM-DD'. */
export type ServicoEscolhido = { id: string; nome: string; precoCentavos: number; duracaoMin: number };
export type Selecao = { servicos: ServicoEscolhido[]; duracaoTotalMin: number; precoTotalCentavos: number };

export type VisaoDoPasso =
  /** Consulta de horários limitada por IP (D-027): nenhum horário foi calculado. */
  | { passo: 'limitado' }
  | { passo: 'servicos'; aviso: CodigoAviso | null }
  | { passo: 'profissional'; s: string[]; selecao: Selecao; profissionais: { id: string; nome: string }[]; aviso: CodigoAviso | null }
  | {
      passo: 'data';
      s: string[];
      p: string;
      selecao: Selecao;
      de: string;
      dias: { data: string; temHorarios: boolean }[];
      anterior: string | null;
      proxima: string | null;
      aviso: CodigoAviso | null;
    }
  | { passo: 'horario'; s: string[]; p: string; data: string; selecao: Selecao; fuso: string; horarios: string[]; aviso: CodigoAviso | null }
  | {
      passo: 'dados';
      s: string[];
      p: string;
      data: string;
      selecao: Selecao;
      fuso: string;
      inicioIso: string;
      profissional: { id: string; nome: string };
    };
