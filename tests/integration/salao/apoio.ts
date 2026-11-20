import type pg from 'pg';

import type { Credencial } from '@/server/tenant/sessao';

import { criarSessao } from '../../support/auth';
import type { SalaoCompleto } from '../../support/factories';

export { ctxDoGestor, ctxDoProfissional } from '../profissionais/apoio';

// Apoio local aos testes de tests/integration/salao (D-017). Não é arquivo de teste (o glob do Vitest
// só pega *.test.ts). SQL direto pelo driver `pg` na base deste worker, sem mocks de banco.

export const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
export const SP = 'America/Sao_Paulo';
export const MANAUS = 'America/Manaus';

export const NAO_ENCONTRADO = { ok: false, erro: 'nao_encontrado', status: 404 } as const;
export const ACESSO_NEGADO = { ok: false, erro: 'acesso_negado', status: 403 } as const;
export const NAO_AUTENTICADO = { ok: false, erro: 'nao_autenticado', status: 401 } as const;

const EXPIRACAO_DISTANTE = new Date('2099-01-01T00:00:00Z');

/** Credencial do gestor (sessão real, expiração distante). */
export async function credGestor(s: SalaoCompleto): Promise<Credencial> {
  return (await criarSessao(s.gestor.usuarioId, { expiraEm: EXPIRACAO_DISTANTE })).credencial;
}

/** Credencial do usuário de papel profissional. */
export async function credProfissional(s: SalaoCompleto): Promise<Credencial> {
  return (await criarSessao(s.profissional.usuarioId, { expiraEm: EXPIRACAO_DISTANTE })).credencial;
}

/** Entrada válida do formulário de regras (textos), com sobrescritas e chaves extras. */
export function regras(sobrescritas: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nome: 'Studio Bela',
    fuso: SP,
    grade: '15',
    antecedencia: '2',
    janela: '60',
    intervalo: '0',
    ...sobrescritas,
  };
}

/** Linha inteira de `salao` (to_jsonb), inclusive atualizado_em: prova byte a byte de "nada mudou". */
export async function linhaSalao(c: pg.Client, salaoId: string): Promise<Record<string, unknown>> {
  const { rows } = await c.query<{ j: Record<string, unknown> }>('SELECT to_jsonb(s) AS j FROM salao s WHERE id = $1', [salaoId]);
  return rows[0].j;
}

export type LinhaSlug = { slug: string; atual: boolean; criado_em: string };

/** Slugs do salão com criado_em (texto exato do banco), por slug. */
export async function slugsDe(c: pg.Client, salaoId: string): Promise<LinhaSlug[]> {
  const { rows } = await c.query<LinhaSlug>(
    `SELECT slug, atual, criado_em::text AS criado_em FROM salao_slug WHERE salao_id = $1 ORDER BY slug`,
    [salaoId],
  );
  return rows;
}

/** Slugs atuais do salão. */
export async function atuaisDe(c: pg.Client, salaoId: string): Promise<string[]> {
  return (await slugsDe(c, salaoId)).filter((l) => l.atual).map((l) => l.slug);
}

/** Dono de um slug (ou undefined). */
export async function donoDoSlug(c: pg.Client, slug: string): Promise<{ salao_id: string; atual: boolean } | undefined> {
  const { rows } = await c.query<{ salao_id: string; atual: boolean }>(
    'SELECT salao_id::text AS salao_id, atual FROM salao_slug WHERE slug = $1',
    [slug],
  );
  return rows[0];
}

/** Grava um slug direto no banco (cenários de histórico de outro salão). */
export async function inserirSlug(c: pg.Client, salaoId: string, slug: string, atual: boolean): Promise<void> {
  await c.query('INSERT INTO salao_slug (slug, salao_id, atual) VALUES ($1, $2, $3)', [slug, salaoId, atual]);
}

/**
 * Deixa o salão com o slug atual `atual` e, opcionalmente, mais históricos: o atual da fábrica vira
 * histórico (permanece no salão). Usado para os CAs com nomes fixos (`studio-bela`).
 */
export async function definirSlugAtual(c: pg.Client, salaoId: string, atual: string): Promise<void> {
  await c.query('BEGIN');
  try {
    await c.query('UPDATE salao_slug SET atual = false WHERE salao_id = $1 AND atual', [salaoId]);
    await c.query(
      `INSERT INTO salao_slug (slug, salao_id, atual) VALUES ($1, $2, true)
       ON CONFLICT (slug) DO UPDATE SET atual = true WHERE salao_slug.salao_id = EXCLUDED.salao_id`,
      [atual, salaoId],
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
}

/** Fotografia (to_jsonb) de jornada, bloqueio, reserva e reserva_item do salão (CA-16). */
export async function fotografiaAgenda(c: pg.Client, salaoId: string): Promise<Record<string, unknown[]>> {
  const r: Record<string, unknown[]> = {};
  for (const tabela of ['jornada', 'bloqueio', 'reserva', 'reserva_item']) {
    const { rows } = await c.query<{ j: unknown }>(`SELECT to_jsonb(t) AS j FROM ${tabela} t WHERE salao_id = $1 ORDER BY id`, [salaoId]);
    r[tabela] = rows.map((l) => l.j);
  }
  return r;
}
