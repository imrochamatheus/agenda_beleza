import { CONTRATOS, type NomeFila, type PayloadDe, type PoliticaFila, validarPayload } from '@/server/queue/filas';

/** Contexto de cada execução de job, entregue pelo envoltório do worker (D-008 §3.7). */
export interface ContextoJob {
  id: string;
  fila: string;
  /** 1 na primeira execução; 2 na primeira nova tentativa; e assim por diante. */
  tentativa: number;
  /** Execuções permitidas para este job: `retryLimit + 1` (D-024 A-16). */
  tentativasMaximas: number;
  /** Instante a partir do qual o pg-boss podia executar esta tentativa (inclui o atraso do retry). */
  agendadoPara: Date;
  /** Abortado quando o encerramento estoura o prazo ou o job perde a posse: pare o trabalho. */
  sinal: AbortSignal;
  /** Registra uma linha JSON `{ evento, em, ...campos }`. Nunca passe o payload nem dados pessoais. */
  log(evento: string, campos?: Record<string, unknown>): void;
}

/** Definição de uma fila de produção: contrato (de src/server/queue/filas.ts) + processamento. */
export interface DefinicaoFila<P = unknown> {
  fila: NomeFila;
  politica: PoliticaFila;
  validarPayload(dados: unknown): P;
  processar(payload: P, ctx: ContextoJob): Promise<void>;
  /** Expressão cron em UTC; o job agendado recebe `{}` (RN-16). */
  cron?: string;
}

/** Liga o contrato da fila ao processamento. Cada arquivo de handler exporta uma definição. */
export function definirHandler<F extends NomeFila>(
  fila: F,
  h: { processar(p: PayloadDe<F>, ctx: ContextoJob): Promise<void>; cron?: string },
): DefinicaoFila<PayloadDe<F>> {
  return {
    fila,
    politica: CONTRATOS[fila].politica,
    validarPayload: (dados) => validarPayload(fila, dados),
    processar: h.processar,
    ...(h.cron ? { cron: h.cron } : {}),
  };
}
