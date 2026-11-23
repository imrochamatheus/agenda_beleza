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
 * Vigência (D-050 RN-30, §3.7; dba.md M-4). Mesma regra de `PREDICADO_VIGENTE` (repos/mensagem.ts), com
 * teste de paridade: `confirmacao` → status derivado `confirmado` (sem comparar revisão: a confirmação é
 * montada no envio com o estado atual); `convite_avaliacao` → `concluido`; `remarcacao` → existe item com
 * `revisao = m.revisao` ainda `confirmado`; `cancelamento` → existe item com `revisao = m.revisao` ainda
 * `cancelado`. Uma remarcação posterior do mesmo item sobe a revisão do item e torna a anterior obsoleta.
 */
export function conferirVigencia(
  tipo: TipoMensagem,
  m: { revisao: number },
  r: { status: StatusReserva; itens: readonly { revisao: number; status: StatusReserva }[] },
): 'vigente' | 'obsoleta' {
  const existeItem = (status: StatusReserva) => r.itens.some((i) => i.revisao === m.revisao && i.status === status);
  switch (tipo) {
    case 'confirmacao':
      return r.status === 'confirmado' ? 'vigente' : 'obsoleta';
    case 'convite_avaliacao':
      return r.status === 'concluido' ? 'vigente' : 'obsoleta';
    case 'remarcacao':
      return existeItem('confirmado') ? 'vigente' : 'obsoleta';
    case 'cancelamento':
      return existeItem('cancelado') ? 'vigente' : 'obsoleta';
  }
}
