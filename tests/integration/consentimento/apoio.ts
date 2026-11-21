import type pg from 'pg';

import { contextoDeSistema } from '@/server/tenant/context';

import type { SalaoCompleto } from '../../support/factories';

export { ctxDoGestor, ctxDoProfissional } from '../profissionais/apoio';
export { anonimizarPorSql, inserirCliente } from '../clientes/apoio';

// Apoio local aos testes de tests/integration/consentimento (D-023). Não é arquivo de teste.

export const AGORA = new Date('2026-11-21T15:30:00.000Z');

/** Contexto de sistema do salão (a reserva pública, E4.2, e a publicação da avaliação, E4.5). */
export const ctxPublico = (s: SalaoCompleto) => contextoDeSistema(s.salaoId, 'teste');

export type LinhaConsentimento = {
  id: string;
  salao_id: string;
  cliente_id: string;
  finalidade: string;
  origem: string;
  versao_termos: string;
  criado_em: Date;
};

/** Linhas de consentimento da cliente (ordem de criação e id). */
export async function linhasDe(c: pg.Client, clienteId: string): Promise<LinhaConsentimento[]> {
  const { rows } = await c.query<LinhaConsentimento>(
    `SELECT id::text, salao_id::text, cliente_id::text, finalidade::text, origem::text, versao_termos, criado_em
       FROM consentimento WHERE cliente_id = $1 ORDER BY criado_em, finalidade::text, id`,
    [clienteId],
  );
  return rows;
}

export async function contarDoSalao(c: pg.Client, salaoId: string): Promise<number> {
  const { rows } = await c.query<{ n: string }>('SELECT count(*) AS n FROM consentimento WHERE salao_id = $1', [salaoId]);
  return Number(rows[0].n);
}

/** Fotografia (to_jsonb) das linhas do salão: prova de "nada mudou". */
export async function fotografiaDoSalao(c: pg.Client, salaoId: string): Promise<unknown[]> {
  const { rows } = await c.query<{ j: unknown }>('SELECT to_jsonb(t) AS j FROM consentimento t WHERE salao_id = $1 ORDER BY id', [salaoId]);
  return rows.map((r) => r.j);
}
