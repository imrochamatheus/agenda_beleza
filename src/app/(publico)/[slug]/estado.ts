import type { ResumoConfirmacao } from '@/server/reserva-publica/tipos';

/** Estado do formulário de dados da reserva pública (D-026 §3). Sem 'use server'. */
export type EstadoReserva = {
  status: 'editando' | 'confirmada' | 'indisponivel' | 'horario_indisponivel';
  mensagem: string | null;
  erros: { nome?: string; telefone?: string; mensagensReserva?: string };
  valores: { nome: string; telefone: string; mensagensReserva: boolean; conviteAvaliacao: boolean };
  /** Mesma chave de idempotência em todas as respostas: o reenvio reaproveita a reserva. */
  chave: string;
  resumo: ResumoConfirmacao | null;
  repetida: boolean;
  /** Conflito de horário (D-036 DEF-1): horários atualizados do mesmo dia, na resposta (sem PRG e sem PII na URL). */
  reescolha?: { fuso: string; horarios: string[] } | null;
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
