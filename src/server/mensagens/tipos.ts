import type {
  EstadoMensagem as EstadoMensagemPrisma,
  TipoMensagem as TipoMensagemPrisma,
} from '@/generated/prisma/enums';
import type { ModeloWhatsApp } from '@/server/integrations/whatsapp/port';
import type { SistemaContext } from '@/server/tenant/context';

// Contratos client-safe do pipeline de mensagens de WhatsApp (D-024 §3.2). Sem I/O.

/** Os tipos de mensagem são exatamente os modelos da porta (e o enum do banco, conferido abaixo). */
export type TipoMensagem = ModeloWhatsApp;
export type EstadoMensagem =
  | 'pendente'
  | 'enviando'
  | 'enviada'
  | 'falhou'
  | 'nao_enviada'
  | 'substituida'
  | 'cancelada_anonimizacao';

// Asserções de tipo: o typecheck falha se as uniões divergirem dos enums do Prisma.
type Igual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Verdadeiro<T extends true> = T;
export type TipoMensagemEquivaleAoEnum = Verdadeiro<Igual<TipoMensagem, TipoMensagemPrisma>>;
export type EstadoMensagemEquivaleAoEnum = Verdadeiro<Igual<EstadoMensagem, EstadoMensagemPrisma>>;

/** Estados dos quais a mensagem nunca mais sai (RN-1); `falhou` só sai por reenvio manual. */
export const ESTADOS_FINAIS: readonly EstadoMensagem[] = [
  'enviada',
  'nao_enviada',
  'substituida',
  'cancelada_anonimizacao',
];

/** `erro_codigo` produzido por esta demanda; os demais vêm da porta (conjunto fechado). */
export const CODIGOS_ERRO = {
  semConsentimento: 'sem_consentimento',
  obsoleta: 'obsoleta',
  substituida: 'substituida',
  resultadoIncerto: 'resultado_incerto',
  linkIndisponivel: 'link_indisponivel',
  erroDesconhecido: 'erro_desconhecido',
} as const;

export type ResultadoRegistro = {
  criada: boolean;
  mensagemId: string;
  tipo: TipoMensagem;
  revisao: number;
  estado: EstadoMensagem;
  /** `reserva:tipo:revisao`. */
  chave: string;
  /** `criada && estado === 'pendente'`: só estas vão à fila. */
  precisaEnfileirar: boolean;
};

export type ResultadoReenvio =
  | { resultado: 'reenfileirada'; mensagemId: string; chave: string }
  | { resultado: 'recusada'; motivo: 'nao_falhou' | 'obsoleta' | 'cliente_anonimizada' };

/** Situação de envio para a E7.3: nunca traz destinatário, parâmetros nem id do provedor (RN-23). */
export type MensagemDaReservaDTO = {
  id: string;
  /** D-050: item da mensagem (null = reserva inteira). */
  reservaItemId: string | null;
  tipo: TipoMensagem;
  revisao: number;
  estado: EstadoMensagem;
  enviadaEm: Date | null;
  erroCodigo: string | null;
  tentativas: number;
  ultimaTentativaEm: Date | null;
};

/**
 * Produz o link do convite de avaliação no envio (RN-14). O valor só existe em memória entre o
 * gerador e a porta: nunca vai a log, parâmetros gravados, tentativa, erro nem payload do job.
 */
export type GeradorLinkAvaliacao = (ctx: SistemaContext, reservaId: string) => Promise<string>;

/** Pedido de reagendamento ao pg-boss: mensagem fixa, nunca carrega a causa (RN-22). */
export class ErroReenvioAgendado extends Error {
  constructor() {
    super('Reenvio agendado pelo backoff da fila.');
    this.name = 'ErroReenvioAgendado';
  }
}
