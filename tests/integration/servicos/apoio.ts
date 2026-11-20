import type pg from 'pg';

import { criarPublicoContext } from '@/server/tenant/context';
import type { PublicoContext } from '@/server/tenant/context';

import type { SalaoCompleto } from '../../support/factories';

export { ctxDoGestor, ctxDoProfissional } from '../profissionais/apoio';

// Apoio local aos testes de tests/integration/servicos (D-014). Não é arquivo de teste (o glob do
// Vitest só pega *.test.ts). SQL direto pelo driver `pg` na base deste worker, sem mocks de banco.

export const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

export type LinhaServico = {
  id: string;
  salao_id: string;
  nome: string;
  preco_centavos: number;
  duracao_min: number;
  ativo: boolean;
  atualizado_em: Date;
};

export async function linhaServico(c: pg.Client, id: string): Promise<LinhaServico | undefined> {
  const { rows } = await c.query<LinhaServico>(
    `SELECT id::text AS id, salao_id::text AS salao_id, nome, preco_centavos, duracao_min, ativo, atualizado_em
       FROM servico WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/** Serviços do salão com esse nome, em ordem de criação. */
export async function servicosPorNome(c: pg.Client, salaoId: string, nome: string): Promise<LinhaServico[]> {
  const { rows } = await c.query<LinhaServico>(
    `SELECT id::text AS id, salao_id::text AS salao_id, nome, preco_centavos, duracao_min, ativo, atualizado_em
       FROM servico WHERE salao_id = $1 AND nome = $2 ORDER BY criado_em, id`,
    [salaoId, nome],
  );
  return rows;
}

export async function contarServicos(c: pg.Client, salaoId: string): Promise<number> {
  const { rows } = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM servico WHERE salao_id = $1', [salaoId]);
  return rows[0].n;
}

/** Ids (ordenados) dos profissionais vinculados ao serviço. */
export async function vinculosDe(c: pg.Client, servicoId: string): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>(
    'SELECT profissional_id::text AS id FROM servico_profissional WHERE servico_id = $1 ORDER BY profissional_id',
    [servicoId],
  );
  return rows.map((r) => r.id);
}

/** Todas as linhas de servico_profissional do salão, como JSON ordenado (prova de "nada mudou"). */
export async function vinculosDoSalao(c: pg.Client, salaoId: string): Promise<unknown[]> {
  const { rows } = await c.query<{ j: unknown }>(
    `SELECT to_jsonb(sp) AS j FROM servico_profissional sp WHERE salao_id = $1
      ORDER BY servico_id, profissional_id`,
    [salaoId],
  );
  return rows.map((r) => r.j);
}

/** reserva e reserva_item do salão, byte a byte (to_jsonb), para provar o snapshot (RN-3). */
export async function fotografiaReservas(c: pg.Client, salaoId: string): Promise<{ reservas: unknown[]; itens: unknown[] }> {
  const reservas = await c.query<{ j: unknown }>('SELECT to_jsonb(r) AS j FROM reserva r WHERE salao_id = $1 ORDER BY id', [
    salaoId,
  ]);
  const itens = await c.query<{ j: unknown }>('SELECT to_jsonb(i) AS j FROM reserva_item i WHERE salao_id = $1 ORDER BY id', [
    salaoId,
  ]);
  return { reservas: reservas.rows.map((r) => r.j), itens: itens.rows.map((r) => r.j) };
}

/** Linha do serviço e os vínculos dele, juntos (prova de "nada mudou" num serviço). */
export async function fotografiaServico(c: pg.Client, id: string): Promise<unknown> {
  return { servico: await linhaServico(c, id), vinculos: await vinculosDe(c, id) };
}

export async function inserirProfissional(c: pg.Client, salaoId: string, nome: string, ativo = true): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    'INSERT INTO profissional (salao_id, nome, ativo) VALUES ($1, $2, $3) RETURNING id::text AS id',
    [salaoId, nome, ativo],
  );
  return rows[0].id;
}

export async function inserirServico(
  c: pg.Client,
  salaoId: string,
  d: { nome: string; precoCentavos?: number; duracaoMin?: number; ativo?: boolean },
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min, ativo)
     VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
    [salaoId, d.nome, d.precoCentavos ?? 5000, d.duracaoMin ?? 30, d.ativo ?? true],
  );
  return rows[0].id;
}

export async function vincular(c: pg.Client, salaoId: string, servicoId: string, profissionalId: string): Promise<void> {
  await c.query('INSERT INTO servico_profissional (salao_id, servico_id, profissional_id) VALUES ($1, $2, $3)', [
    salaoId,
    servicoId,
    profissionalId,
  ]);
}

export function ctxPublico(s: SalaoCompleto): PublicoContext {
  return criarPublicoContext(s.salaoId, s.slugAtual);
}
