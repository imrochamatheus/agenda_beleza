import type { ErrosAvaliacao } from '@/server/avaliacoes/tipos';

/** Estado do formulário de avaliação (D-032). Sem 'use server'. */
export type EstadoAvaliacao = {
  /** `inicial`: vale o veredito da página (GET); os demais vêm da ação e prevalecem sobre ele. */
  status: 'inicial' | 'editando' | 'enviada' | 'invalido' | 'limitado';
  mensagem: string | null;
  erros: ErrosAvaliacao;
  valores: { nota: string; comentario: string; aceite: boolean };
};

export const ESTADO_INICIAL_AVALIACAO: EstadoAvaliacao = {
  status: 'inicial',
  mensagem: null,
  erros: {},
  valores: { nota: '', comentario: '', aceite: false },
};

export type AcaoAvaliar = (anterior: EstadoAvaliacao, formData: FormData) => Promise<EstadoAvaliacao>;
