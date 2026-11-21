import type { StatusReserva } from '@/server/repos/tipos';

import { CODIGOS_ERRO } from './tipos';
import type { TipoMensagem } from './tipos';

// Regras puras, sem I/O (D-024 §3.3). Mesma função no registro e no envio (A-1).

export type EntradaElegibilidade = {
  tipo: TipoMensagem;
  clienteAnonimizada: boolean;
  telefone: string | null;
  /** Consentimento vigente da finalidade `mensagens_reserva`. */
  consentimentoMensagens: boolean;
  /** Consentimento vigente da finalidade `convite_avaliacao`. */
  consentimentoConvite: boolean;
};

export type Decisao =
  | { acao: 'enviar' }
  | {
      acao: 'terminal';
      estado: 'nao_enviada' | 'cancelada_anonimizacao';
      erroCodigo: string | null;
    };

/**
 * RN-8/RN-12: anonimizada (ou sem telefone) → `cancelada_anonimizacao`; senão exige o consentimento
 * da finalidade do tipo; sem ele → `nao_enviada` (`sem_consentimento`).
 */
export function decidirElegibilidade(e: EntradaElegibilidade): Decisao {
  if (e.clienteAnonimizada || e.telefone === null) {
    return { acao: 'terminal', estado: 'cancelada_anonimizacao', erroCodigo: null };
  }
  const consentiu = e.tipo === 'convite_avaliacao' ? e.consentimentoConvite : e.consentimentoMensagens;
  if (!consentiu) {
    return { acao: 'terminal', estado: 'nao_enviada', erroCodigo: CODIGOS_ERRO.semConsentimento };
  }
  return { acao: 'enviar' };
}

/**
 * RN-16: a mensagem ainda descreve o estado da reserva? `confirmacao`/`remarcacao`: mesma revisão e
 * reserva `confirmado`; `cancelamento`: mesma revisão e `cancelado`; `convite_avaliacao`: `concluido`.
 */
export function conferirVigencia(
  tipo: TipoMensagem,
  m: { revisao: number },
  r: { revisao: number; status: StatusReserva },
): 'vigente' | 'obsoleta' {
  switch (tipo) {
    case 'confirmacao':
    case 'remarcacao':
      return m.revisao === r.revisao && r.status === 'confirmado' ? 'vigente' : 'obsoleta';
    case 'cancelamento':
      return m.revisao === r.revisao && r.status === 'cancelado' ? 'vigente' : 'obsoleta';
    case 'convite_avaliacao':
      return r.status === 'concluido' ? 'vigente' : 'obsoleta';
  }
}
