// Contratos de remarcar, cancelar e marcar status (D-030). Client-safe: só tipos e constantes.
import type { ResultadoRegistro } from '@/server/mensagens/tipos';
import type { StatusReserva } from '@/server/repos/tipos';

import type { MotivoRecusaDeStatus } from './status';
import type { PoliticaOperacao } from '@/server/tenant/politica';

import type { CausaIndisponibilidade, DependenciasCriarReserva, ErrosReserva, MotivoEncaixe, ReservaCriada } from './tipos';

export type MotivoRecusa = MotivoRecusaDeStatus | 'sem_alteracao';

/** Estado da mensagem registrada na mesma transação (o envio é assíncrono). */
export type MensagemRegistrada = { mensagemId: string; estado: ResultadoRegistro['estado'] };

export type ResultadoRemarcar =
  | { resultado: 'atualizada'; reserva: ReservaCriada; mensagem: MensagemRegistrada }
  | { resultado: 'invalido'; erros: ErrosReserva }
  | { resultado: 'recusado'; motivo: MotivoRecusa }
  | { resultado: 'horario_indisponivel'; causa: CausaIndisponibilidade }
  | { resultado: 'servico_indisponivel' }
  | { resultado: 'profissional_indisponivel' }
  | { resultado: 'encaixe_requer_confirmacao'; motivos: MotivoEncaixe[] };

export type ResultadoStatus =
  | { resultado: 'atualizada'; status: StatusReserva; revisao: number; mensagem: MensagemRegistrada | null }
  | { resultado: 'recusado'; motivo: MotivoRecusa };

export type EntradaRemarcar = {
  reservaId: unknown;
  /** AAAA-MM-DD no fuso do salão. */
  data: unknown;
  /** HH:MM no fuso do salão. */
  hora: unknown;
  profissionalId: unknown;
  /** Lista completa dos serviços da reserva depois da alteração. */
  servicoIds: unknown;
  /** Só `true`/'on' confirma o encaixe. */
  confirmarEncaixe?: unknown;
};

export type EntradaCancelar = { reservaId: unknown };
export type EntradaMarcarStatus = { reservaId: unknown; para: unknown };

export type DependenciasAlteracao = Pick<DependenciasCriarReserva, 'enfileirar'> & {
  /** Política (D-038): padrão `politicaDeOperacao`. Negar lança 403 antes de abrir a transação. */
  politica?: PoliticaOperacao;
  /** SÓ TESTE: barreira depois das travas de salão/profissional/serviços e antes de travar a reserva. */
  aposTravas?: () => Promise<void>;
};

export const MENSAGENS_ALTERACAO = Object.freeze({
  inicio: 'Informe uma data e uma hora válidas (HH:MM).',
  inicioPassado: 'O novo horário não pode estar no passado.',
  servicos: 'Escolha de um a dez serviços, sem repetir.',
  transicao_invalida: 'Esta ação não é possível para a situação atual da reserva.',
  ainda_nao_iniciada: 'A reserva ainda não começou.',
  ja_terminada: 'A reserva já terminou e não pode mais ser cancelada.',
  reserva_final: 'A reserva já foi cancelada.',
  sem_alteracao: 'Nenhuma alteração: informe outro horário, profissional ou serviços.',
  remarcada: 'Reserva atualizada.',
  cancelada: 'Reserva cancelada.',
  concluida: 'Reserva marcada como concluída.',
  naoCompareceu: 'Reserva marcada como não compareceu.',
  acessoNegado: 'Acesso negado.',
  naoEncontrado: 'Reserva não encontrada.',
  generico: 'Não foi possível concluir a ação. Tente de novo.',
} satisfies Record<string, string>);
