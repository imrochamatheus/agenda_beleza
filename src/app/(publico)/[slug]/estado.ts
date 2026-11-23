import type { ReescolhaDosItens, ResumoConfirmacao } from '@/server/reserva-publica/tipos';

/** Reescolha montada (D-050 CA-10): itens mantidos, itens abertos com as alternativas e o estado da URL. */
export type ReescolhaNoEstado = Extract<ReescolhaDosItens, { resultado: 'reescolher' }>;

/** Estado do formulário de dados da reserva pública (D-026 §3; D-050 §3.10). Sem 'use server'. */
export type EstadoReserva = {
  status: 'editando' | 'confirmada' | 'indisponivel' | 'horario_indisponivel';
  mensagem: string | null;
  erros: { nome?: string; telefone?: string; mensagensReserva?: string };
  valores: { nome: string; telefone: string; mensagensReserva: boolean; conviteAvaliacao: boolean };
  /** Mesma chave de idempotência em todas as respostas: o reenvio reaproveita a reserva. */
  chave: string;
  resumo: ResumoConfirmacao | null;
  repetida: boolean;
  /**
   * Conflito de horário (D-036 DEF-1; D-050 CA-10): itens que caíram (ou reabertos) com os horários atualizados
   * do mesmo dia, na resposta (sem PRG e sem PII na URL).
   */
  reescolha?: ReescolhaNoEstado | null;
};

export function estadoInicialReserva(chave: string): EstadoReserva {
  return {
    status: 'editando',
    mensagem: null,
    erros: {},
    valores: { nome: '', telefone: '', mensagensReserva: false, conviteAvaliacao: false },
    chave,
    resumo: null,
    repetida: false,
  };
}

export type AcaoReservar = (anterior: EstadoReserva, formData: FormData) => Promise<EstadoReserva>;
