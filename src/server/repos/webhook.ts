import { obterPrisma } from './db';
import type { Executor } from './transacao';

// Repositório de sistema de `webhook_evento` (D-041 §2). Tabela de plataforma, sem salão no momento do
// recebimento (o salão só é resolvido depois, pelo vínculo `provedor_assinatura_id`): exceção documentada
// ao escopo por salão, no mesmo padrão de rate-limit.ts e cadastro.ts. Nenhum comando aqui segura trava
// de assinatura: cada instrução é autocommit, então não há ciclo com `aplicarEventoAssinatura`.
// Dedupe só entre válidos: `ON CONFLICT (provedor, chave_dedupe) WHERE origem_valida DO NOTHING`
// (índice parcial `webhook_evento_dedupe_uniq`); nunca se captura 23505. O lease de reprocesso usa
// `recebido_em` (o enum não tem "processando"): reivindicar reinicia o relógio.

export const PROVEDOR_MP = 'mercadopago';

export type ResultadoFinal = 'processado' | 'ignorado' | 'erro';
export type EstadoWebhook = 'recebido' | 'processado' | 'ignorado' | 'rejeitado' | 'erro';

export type EntradaRegistro = {
  chaveDedupe: string;
  tipo: string | null;
  recursoId: string | null;
  payload: Record<string, unknown>;
  origemValida: boolean;
  agora: Date;
};

export type ResultadoRegistro =
  | { criada: true; id: string }
  | { criada: false; id: string; resultado: EstadoWebhook; recebidoEm: Date };

export interface RepoWebhookSistema {
  /** Válido: nasce `recebido`; inválido: nasce `rejeitado` com `processado_em`, fora do índice de dedupe. */
  registrar(e: EntradaRegistro): Promise<ResultadoRegistro>;
  /** CAS do lease: `erro`, ou `recebido` mais velho que 2 min. `false` = outra entrega assumiu. */
  reivindicar(id: string, agora: Date): Promise<boolean>;
  /** Grava o salão resolvido (a linha existe desde o INSERT, então a FK de `assinatura_transicao` é satisfeita). */
  vincularSalao(id: string, salaoId: string): Promise<void>;
  /** Fecha a linha só se ainda `recebido`. `processado_em` só em `processado`/`ignorado`. */
  concluir(id: string, d: { resultado: ResultadoFinal; salaoId?: string; erro?: string; agora: Date }): Promise<boolean>;
}

/** Tempo do lease de `recebido` (D-041 R-1). */
export const LEASE_RECEBIDO_MS = 2 * 60 * 1000;

export function criarRepoWebhookSistema(db?: Executor): RepoWebhookSistema {
  const cliente = () => db ?? obterPrisma();
  return {
    async registrar(e) {
      const payload = JSON.stringify(e.payload);
      if (!e.origemValida) {
        const [l] = await cliente().$queryRaw<{ id: string }[]>`
          INSERT INTO webhook_evento (provedor, chave_dedupe, tipo, recurso_id, payload, origem_valida, resultado, recebido_em, processado_em)
          VALUES (${PROVEDOR_MP}, ${e.chaveDedupe}, ${e.tipo}, ${e.recursoId}, ${payload}::jsonb, false, 'rejeitado',
                  ${e.agora}::timestamptz, ${e.agora}::timestamptz)
          RETURNING id::text AS id`;
        return { criada: true, id: l.id };
      }
      const inseridas = await cliente().$queryRaw<{ id: string }[]>`
        INSERT INTO webhook_evento (provedor, chave_dedupe, tipo, recurso_id, payload, origem_valida, resultado, recebido_em)
        VALUES (${PROVEDOR_MP}, ${e.chaveDedupe}, ${e.tipo}, ${e.recursoId}, ${payload}::jsonb, true, 'recebido', ${e.agora}::timestamptz)
        ON CONFLICT (provedor, chave_dedupe) WHERE origem_valida DO NOTHING
        RETURNING id::text AS id`;
      if (inseridas[0]) return { criada: true, id: inseridas[0].id };
      const existentes = await cliente().$queryRaw<{ id: string; resultado: EstadoWebhook; recebido_em: Date }[]>`
        SELECT id::text AS id, resultado::text AS resultado, recebido_em
          FROM webhook_evento
         WHERE provedor = ${PROVEDOR_MP} AND chave_dedupe = ${e.chaveDedupe} AND origem_valida`;
      const x = existentes[0];
      if (!x) throw new Error('webhook_evento: conflito sem linha existente');
      return { criada: false, id: x.id, resultado: x.resultado, recebidoEm: x.recebido_em };
    },

    async reivindicar(id, agora) {
      const linhas = await cliente().$queryRaw<{ id: string }[]>`
        UPDATE webhook_evento
           SET resultado = 'recebido', erro = NULL, processado_em = NULL, recebido_em = ${agora}::timestamptz
         WHERE id = ${id}::uuid AND origem_valida
           AND (resultado = 'erro'
                OR (resultado = 'recebido' AND recebido_em < ${agora}::timestamptz - interval '2 minutes'))
        RETURNING id::text AS id`;
      return linhas.length === 1;
    },

    async vincularSalao(id, salaoId) {
      await cliente().$executeRaw`
        UPDATE webhook_evento SET salao_id = ${salaoId}::uuid WHERE id = ${id}::uuid AND resultado = 'recebido'`;
    },

    async concluir(id, d) {
      const terminal = d.resultado !== 'erro';
      const n = await cliente().$executeRaw`
        UPDATE webhook_evento
           SET resultado = ${d.resultado}::resultado_webhook,
               erro = ${d.erro ?? null},
               salao_id = COALESCE(${d.salaoId ?? null}::uuid, salao_id),
               processado_em = ${terminal ? d.agora : null}::timestamptz
         WHERE id = ${id}::uuid AND resultado = 'recebido'`;
      return n === 1;
    },
  };
}

export function repoWebhookSistema(): RepoWebhookSistema {
  return criarRepoWebhookSistema();
}
