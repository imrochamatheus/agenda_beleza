// Estado e conversão dos formulários de alterar a reserva (D-030 CA-13). Sem next/*, sem banco e sem imports
// de runtime de servidor além de tipos/constantes client-safe: é importado por componentes cliente, pela casca
// 'use server' (acoes.ts) e pela vitrine. Sem PRG para erros; o sucesso é PRG (`?resultado=<código>`).
import { MENSAGEM_HORARIO_INDISPONIVEL } from '@/server/reservas/tipos';
import type { MotivoEncaixe } from '@/server/reservas/tipos';
import { MENSAGENS_ALTERACAO } from '@/server/reservas/tipos-alteracao';
import type { EntradaRemarcar, MotivoRecusa, ResultadoRemarcar, ResultadoStatus } from '@/server/reservas/tipos-alteracao';
import { MENSAGENS_RESERVA_EQUIPE } from '@/server/reservas/tipos';

/** Lista fechada de resultados que a página mostra depois do redirect de sucesso. */
export const RESULTADOS_PRG = ['remarcada', 'cancelada', 'concluida', 'nao_compareceu'] as const;
export type ResultadoPrg = (typeof RESULTADOS_PRG)[number];

export const MENSAGEM_DO_RESULTADO: Readonly<Record<ResultadoPrg, string>> = Object.freeze({
  remarcada: MENSAGENS_ALTERACAO.remarcada,
  cancelada: MENSAGENS_ALTERACAO.cancelada,
  concluida: MENSAGENS_ALTERACAO.concluida,
  nao_compareceu: MENSAGENS_ALTERACAO.naoCompareceu,
});

export function lerResultadoPrg(v: string | string[] | undefined): ResultadoPrg | null {
  return typeof v === 'string' && (RESULTADOS_PRG as readonly string[]).includes(v) ? (v as ResultadoPrg) : null;
}

export type CampoRemarcar = 'servicos' | 'profissional' | 'data' | 'hora';

export type ValoresRemarcar = {
  /** AAAA-MM-DD */
  data: string;
  /** HH:MM */
  hora: string;
  profissionalId: string;
  servicoIds: string[];
  confirmarEncaixe: boolean;
};

export type EstadoRemarcar = {
  mensagem: string | null;
  erros: Partial<Record<CampoRemarcar, string>>;
  valores: ValoresRemarcar;
  motivos: MotivoEncaixe[] | null;
};

export type EstadoMarcar = { mensagem: string | null };
/** `confirmando`: o segundo passo do cancelamento (sem diálogo de JavaScript). */
export type EstadoCancelar = { mensagem: string | null; confirmando: boolean };

export const estadoMarcarInicial: EstadoMarcar = { mensagem: null };
export const estadoCancelarInicial: EstadoCancelar = { mensagem: null, confirmando: false };
export const estadoRemarcarInicial = (valores: ValoresRemarcar): EstadoRemarcar => ({ mensagem: null, erros: {}, valores, motivos: null });

export const idDoCampoRemarcar = (c: CampoRemarcar): string => `remarcar-${c}`;

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

export function lerFormularioRemarcar(fd: FormData): { entrada: EntradaRemarcar; valores: ValoresRemarcar } {
  const servicoIds = fd.getAll('s').filter((x): x is string => typeof x === 'string');
  const valores: ValoresRemarcar = {
    data: texto(fd.get('data')).slice(0, 10),
    hora: texto(fd.get('hora')).slice(0, 5),
    profissionalId: texto(fd.get('profissionalId')).slice(0, 40),
    servicoIds: servicoIds.slice(0, 10),
    confirmarEncaixe: fd.get('confirmarEncaixe') === 'on',
  };
  return {
    valores,
    entrada: {
      reservaId: texto(fd.get('reservaId')),
      data: texto(fd.get('data')),
      hora: texto(fd.get('hora')),
      profissionalId: texto(fd.get('profissionalId')),
      servicoIds,
      confirmarEncaixe: fd.get('confirmarEncaixe'),
    },
  };
}

export const MENSAGEM_DA_RECUSA = (m: MotivoRecusa): string => MENSAGENS_ALTERACAO[m];

export const MENSAGENS_FORMULARIO_ALTERACAO = Object.freeze({
  servicoIndisponivel: 'Algum serviço escolhido não está disponível.',
  profissionalIndisponivel: 'Este profissional está inativo ou não realiza todos os serviços escolhidos.',
  resumoErros: 'Corrija os campos indicados para remarcar a reserva.',
});

/** Desfecho de `remarcarReserva` → estado do formulário (o sucesso não passa por aqui: é PRG). */
export function paraEstadoRemarcar(r: ResultadoRemarcar, valores: ValoresRemarcar): EstadoRemarcar {
  const base: EstadoRemarcar = { mensagem: null, erros: {}, valores, motivos: null };
  switch (r.resultado) {
    case 'atualizada':
      return base;
    case 'encaixe_requer_confirmacao':
      return { ...base, motivos: r.motivos, mensagem: MENSAGENS_RESERVA_EQUIPE.encaixeAviso };
    case 'horario_indisponivel':
      return { ...base, mensagem: MENSAGEM_HORARIO_INDISPONIVEL };
    case 'servico_indisponivel':
      return { ...base, erros: { servicos: MENSAGENS_FORMULARIO_ALTERACAO.servicoIndisponivel } };
    case 'profissional_indisponivel':
      return { ...base, erros: { profissional: MENSAGENS_FORMULARIO_ALTERACAO.profissionalIndisponivel } };
    case 'invalido': {
      const { servicos, inicio } = r.erros;
      const erros: EstadoRemarcar['erros'] = { ...(servicos && { servicos }), ...(inicio && { data: inicio }) };
      return { ...base, erros, mensagem: Object.keys(erros).length === 0 ? MENSAGENS_ALTERACAO.generico : null };
    }
    case 'recusado':
      return { ...base, mensagem: MENSAGEM_DA_RECUSA(r.motivo) };
  }
}

/** Código do PRG de sucesso de uma operação de status. */
export function resultadoPrgDeStatus(r: Extract<ResultadoStatus, { resultado: 'atualizada' }>): ResultadoPrg {
  return r.status === 'cancelado' ? 'cancelada' : r.status === 'concluido' ? 'concluida' : 'nao_compareceu';
}
