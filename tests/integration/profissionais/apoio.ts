import { randomBytes } from 'node:crypto';

import type pg from 'pg';

import { criarTenantContext } from '@/server/tenant/context';
import type { TenantContext } from '@/server/tenant/context';

import type { SalaoCompleto } from '../../support/factories';
import { inserirReservaComItens as inserirReservaComItensSql } from '../../support/sql';

// Apoio local aos testes de tests/integration/profissionais (D-013). Não é arquivo de teste (o glob
// do Vitest só pega *.test.ts). SQL direto pelo driver `pg` na base deste worker, sem mocks de banco.

export const MIN_MS = 60_000;

/** Contexto do gestor do salão, igual ao que resolverTenant montaria. */
export function ctxDoGestor(s: SalaoCompleto, profissionalId = s.gestor.profissionalId): TenantContext {
  return criarTenantContext({ usuarioId: s.gestor.usuarioId, papel: 'gestor', salaoId: s.salaoId, profissionalId });
}

export function ctxDoProfissional(s: SalaoCompleto): TenantContext {
  return criarTenantContext({
    usuarioId: s.profissional.usuarioId,
    papel: 'profissional',
    salaoId: s.salaoId,
    profissionalId: s.profissional.profissionalId,
  });
}

/**
 * Cancela as reservas criadas pela fábrica (R-8): o profissional fica sem item futuro confirmado. D-050:
 * cancela os ITENS e grava os derivados coerentes na reserva (status `cancelado`, `cancelada_em`).
 */
export async function cancelarReservasDoSalao(c: pg.Client, salaoId: string): Promise<void> {
  await c.query(`UPDATE reserva_item SET status = 'cancelado' WHERE salao_id = $1`, [salaoId]);
  await c.query(`UPDATE reserva SET status = 'cancelado', cancelada_em = now() WHERE salao_id = $1`, [salaoId]);
}

/** Cancela todos os itens das reservas dadas e a própria reserva (derivados coerentes, D-050). */
export async function cancelarReservas(c: pg.Client, ids: string[]): Promise<void> {
  await c.query(`UPDATE reserva_item SET status = 'cancelado' WHERE reserva_id = ANY($1::uuid[])`, [ids]);
  await c.query(`UPDATE reserva SET status = 'cancelado', cancelada_em = now() WHERE id = ANY($1::uuid[])`, [ids]);
}

export type ReservaDeTeste = {
  salaoId: string;
  profissionalId: string;
  clienteId: string;
  inicio: Date;
  fim: Date;
  status?: 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
  /**
   * Serviços dos itens, na ordem, todos com `profissionalId`, encadeados a partir de `inicio`: os itens
   * depois do primeiro têm 1 min e o primeiro fica com o resto (no mínimo 1 min), de modo que o envelope
   * continua [inicio, fim) sempre que `fim - inicio` ≥ número de itens.
   */
  servicoIds: string[];
};

/** Reserva com itens (snapshot fictício de preço 1000), derivados coerentes (D-050). Devolve o id da reserva. */
export async function inserirReservaComItens(c: pg.Client, r: ReservaDeTeste): Promise<string> {
  const total = Math.round((r.fim.getTime() - r.inicio.getTime()) / MIN_MS);
  const primeiro = Math.max(1, total - (r.servicoIds.length - 1));
  let t = r.inicio.getTime();
  const itens = r.servicoIds.map((servicoId, k) => {
    const duracaoMin = k === 0 ? primeiro : 1;
    const inicio = new Date(t);
    t += duracaoMin * MIN_MS;
    return { profissionalId: r.profissionalId, inicio, duracaoMin, servicoId, precoCentavos: 1000, status: r.status ?? 'confirmado' };
  });
  const { reservaId } = await inserirReservaComItensSql(c, { salaoId: r.salaoId, clienteId: r.clienteId, itens, origem: 'equipe' });
  return reservaId;
}

export type EstadoConvite = 'pendente' | 'aceito' | 'invalidado';

/** Convite do profissional no estado pedido. Devolve o id. */
export async function inserirConvite(
  c: pg.Client,
  d: { salaoId: string; profissionalId: string; estado: EstadoConvite },
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO convite (salao_id, profissional_id, email, token_hash, expira_em, aceito_em, invalidado_em)
     VALUES ($1, $2, $3, $4, now() + interval '7 days', $5, $6) RETURNING id::text AS id`,
    [
      d.salaoId,
      d.profissionalId,
      `convite-${randomBytes(6).toString('hex')}@exemplo.com.br`,
      randomBytes(32).toString('hex'),
      d.estado === 'aceito' ? new Date('2026-01-01T00:00:00Z') : null,
      d.estado === 'invalidado' ? new Date('2026-01-02T00:00:00Z') : null,
    ],
  );
  return rows[0].id;
}

export type LinhaProfissional = {
  id: string;
  salao_id: string;
  usuario_id: string | null;
  nome: string;
  email: string | null;
  ativo: boolean;
  atualizado_em: Date;
};

export async function linhaProfissional(c: pg.Client, id: string): Promise<LinhaProfissional | undefined> {
  const { rows } = await c.query<LinhaProfissional>(
    `SELECT id::text AS id, salao_id::text AS salao_id, usuario_id::text AS usuario_id, nome, email, ativo, atualizado_em
       FROM profissional WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/** Sessões do usuário: [id, revogada_em]. */
export async function sessoesDe(c: pg.Client, usuarioId: string): Promise<{ id: string; revogada_em: Date | null }[]> {
  const { rows } = await c.query<{ id: string; revogada_em: Date | null }>(
    'SELECT id::text AS id, revogada_em FROM sessao WHERE usuario_id = $1 ORDER BY id',
    [usuarioId],
  );
  return rows;
}

/**
 * Fotografia de sessões, convites e profissionais de um salão (para provar "nada mudou"). Das sessões
 * só entra `revogada_em`: `expira_em` muda legitimamente com a renovação no uso (D-010 RN-10).
 */
export async function fotografiaDoSalao(c: pg.Client, salaoId: string): Promise<unknown> {
  const sessoes = await c.query(
    `SELECT s.id, s.revogada_em FROM sessao s JOIN usuario u ON u.id = s.usuario_id
      WHERE u.salao_id = $1 ORDER BY s.id`,
    [salaoId],
  );
  const convites = await c.query('SELECT id, aceito_em, invalidado_em FROM convite WHERE salao_id = $1 ORDER BY id', [
    salaoId,
  ]);
  const profissionais = await c.query(
    'SELECT id, nome, email, ativo, usuario_id, atualizado_em FROM profissional WHERE salao_id = $1 ORDER BY id',
    [salaoId],
  );
  return { sessoes: sessoes.rows, convites: convites.rows, profissionais: profissionais.rows };
}
