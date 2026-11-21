import { z } from 'zod';

import { ErroPayloadInvalido } from './erros';

// Contratos das filas (D-008 §3.4): nome, política do pg-boss, exigência de chave e esquema do payload.
// A app (cliente) e o worker (handlers) importam daqui; o cliente valida sem importar código do worker.
// RN-5/RN-11: payload só com identificadores (UUID), em objeto estrito. Exceção: `exemplo` (D-4).

/** Nomes das filas de produção. Nenhum nome de fila aparece como texto solto fora daqui (RN-8). */
export const FILA = {
  exemplo: 'exemplo',
  assinaturaPrazos: 'assinatura-prazos',
  whatsappReserva: 'whatsapp-reserva',
  reconciliarMensagens: 'reconciliar-mensagens',
  limparRateLimit: 'limpar-rate-limit',
} as const;

export type NomeFila = (typeof FILA)[keyof typeof FILA];

export type PoliticaFila = 'standard' | 'exclusive';

export type ContratoFila = {
  /**
   * Política do pg-boss, imutável depois da criação da fila. `exclusive`: no máximo um job por
   * `singletonKey` em created/retry/active (D-7); sem chave, no máximo um job da fila inteira.
   */
  politica: PoliticaFila;
  /** `obrigatoria`: enfileirar sem `chave` é recusado (sem ela, a `exclusive` deduplicaria a fila toda). */
  chave: 'obrigatoria' | 'opcional';
  payload: z.ZodType;
};

export const CONTRATOS = {
  // D-4: único payload que não é só de IDs (não identifica ninguém).
  exemplo: {
    politica: 'standard',
    chave: 'opcional',
    payload: z.strictObject({ esperaMs: z.int().min(0).max(60_000).optional() }),
  },
  'assinatura-prazos': { politica: 'exclusive', chave: 'opcional', payload: z.strictObject({}) },
  // Contrato definitivo (D-024): a chave é `reserva:tipo:revisao`; o payload não leva dado pessoal nem link.
  'whatsapp-reserva': {
    politica: 'exclusive',
    chave: 'obrigatoria',
    payload: z.strictObject({ mensagemId: z.uuid() }),
  },
  'reconciliar-mensagens': { politica: 'exclusive', chave: 'opcional', payload: z.strictObject({}) },
  // D-027: limpeza horária das janelas expiradas de `rate_limit_janela`.
  'limpar-rate-limit': { politica: 'exclusive', chave: 'opcional', payload: z.strictObject({}) },
} as const satisfies Record<NomeFila, ContratoFila>;

export type PayloadDe<F extends NomeFila> = z.infer<(typeof CONTRATOS)[F]['payload']>;

/** Indica se `nome` é uma fila de produção conhecida. */
export function ehNomeFila(nome: unknown): nome is NomeFila {
  return typeof nome === 'string' && Object.hasOwn(CONTRATOS, nome);
}

/**
 * Valida o payload sem I/O. Lança ErroPayloadInvalido com os caminhos dos campos, sem valores.
 * Fila desconhecida: `campos: ['(fila)']`; payload que não é objeto: `['(raiz)']`.
 */
export function validarPayload<F extends NomeFila>(fila: F, dados: unknown): PayloadDe<F> {
  if (!ehNomeFila(fila)) throw new ErroPayloadInvalido(String(fila), ['(fila)']);
  const r = CONTRATOS[fila].payload.safeParse(dados);
  if (r.success) return r.data as PayloadDe<F>;
  const campos = r.error.issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') return issue.keys;
    return [issue.path.length > 0 ? issue.path.join('.') : '(raiz)'];
  });
  throw new ErroPayloadInvalido(fila, campos);
}
