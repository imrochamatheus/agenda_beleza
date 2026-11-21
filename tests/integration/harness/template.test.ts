import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';

import { nomesDaExecucao, urlComBase } from '../../support/banco';
import { nomeDoWorker, recriarBaseDoWorker, urlDoWorker } from '../../support/db';
import { prepararExecucao } from '../../support/global-setup';
import { conectar, criarSalao } from '../../support/sql';

// Porta 1 em localhost: nada escuta ali. Se o harness abrisse uma conexão antes da guarda,
// o erro seria ECONNREFUSED, e não a mensagem da guarda (CA-17; CA-21 da D-004 adaptado).
const PORTA_FECHADA_DEV = 'postgresql://agenda:x@localhost:1/agenda_beleza';
const PORTA_FECHADA_TESTE = 'postgresql://agenda:x@localhost:1/agenda_beleza_test';

async function estadoDaBase(): Promise<{ base: string; saloes: number; migracoes: string[]; marcador: number[] }> {
  const c = await conectar();
  try {
    const base = (await c.query<{ b: string }>('SELECT current_database() AS b')).rows[0].b;
    const saloes = (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM salao')).rows[0].n;
    const migracoes = (
      await c.query<{ m: string }>(
        `SELECT migration_name AS m FROM _prisma_migrations
         WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
      )
    ).rows.map((r) => r.m);
    const marcador = (await c.query<{ id: number }>('SELECT id FROM harness_extensao.marcador')).rows.map((r) => r.id);
    return { base, saloes, migracoes, marcador };
  } finally {
    await c.end();
  }
}

// Contrato de migrações: D-004 (3), D-007 (simuladores), D-020 (perfil e funcionamento) e D-021 (fotos). Ver
// docs/demandas/D-007/dba.md e docs/demandas/D-020/dba.md.
const MIGRACOES = [
  '20261118000000_init',
  '20261118000100_reserva_exclusion',
  '20261118000200_restricoes_sql',
  '20261119000000_simuladores_integracao',
  '20261120000000_perfil_funcionamento',
  '20261121000000_salao_foto',
  '20261121100000_consentimento_finalidade',
  '20261121200000_tipo_mensagem_convite_avaliacao',
  '20261121200100_mensagem_reconciliacao',
  '20261122000000_avaliacao',
];

describe('CA-17: a guarda roda antes de qualquer conexão (prepararExecucao)', () => {
  it('CA-17: TEST_DATABASE_URL ausente falha com a mensagem da guarda, sem tentar conectar', async () => {
    await expect(prepararExecucao({ DATABASE_URL: PORTA_FECHADA_DEV }, 4)).rejects.toThrow(
      /^TEST_DATABASE_URL não definida/,
    );
  });

  it('CA-17: TEST_DATABASE_URL com a mesma base de DATABASE_URL falha sem tentar conectar', async () => {
    await expect(
      prepararExecucao(
        { DATABASE_URL: PORTA_FECHADA_DEV, TEST_DATABASE_URL: 'postgresql://outro:y@127.0.0.1:1/agenda_beleza?schema=public' },
        4,
      ),
    ).rejects.toThrow(/^TEST_DATABASE_URL aponta para a mesma base de DATABASE_URL/);
  });

  it('CA-17: base de teste de sistema falha sem tentar conectar', async () => {
    await expect(
      prepararExecucao({ DATABASE_URL: PORTA_FECHADA_DEV, TEST_DATABASE_URL: urlComBase(PORTA_FECHADA_TESTE, 'postgres') }, 4),
    ).rejects.toThrow(/^A base de TEST_DATABASE_URL não pode ser uma base de sistema/);
  });

  it('CA-17: base de teste com 47 caracteres (derivado > 63) falha sem tentar conectar', async () => {
    await expect(
      prepararExecucao({ TEST_DATABASE_URL: urlComBase(PORTA_FECHADA_TESTE, 'a'.repeat(47)) }, 4),
    ).rejects.toThrow(/mais de 46 caracteres/);
  });

  it('controle: passada a guarda, o harness conecta na URL de teste (a porta fechada dá ECONNREFUSED)', async () => {
    await expect(
      prepararExecucao({ DATABASE_URL: PORTA_FECHADA_DEV, TEST_DATABASE_URL: PORTA_FECHADA_TESTE }, 4),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
});

describe('CA-15: base do worker recriada a partir do template', () => {
  it('CA-15: no início do arquivo a base é a deste worker, sem dados, com todas as migrações e o schema do inicializador', async () => {
    const plano = inject('bancoDeTeste');
    const id = Number(process.env.VITEST_POOL_ID);
    // R-3: o maxWorkers do projeto vale (VITEST_POOL_ID entre 1 e maxWorkers).
    expect(id).toBeGreaterThanOrEqual(1);
    expect(id).toBeLessThanOrEqual(plano.maxWorkers);
    expect(nomeDoWorker()).toBe(nomesDaExecucao(plano.base, plano.exec).worker(id));
    expect(process.env.DATABASE_URL).toBe(urlDoWorker());

    expect(await estadoDaBase()).toEqual({ base: nomeDoWorker(), saloes: 0, migracoes: MIGRACOES, marcador: [1] });
  });

  it('CA-15: dados gravados somem quando a base é recriada (sem TRUNCATE)', async () => {
    const c = await conectar();
    try {
      await criarSalao(c);
    } finally {
      await c.end();
    }
    expect((await estadoDaBase()).saloes).toBe(1);

    await expect(recriarBaseDoWorker()).resolves.toBe(urlDoWorker());

    expect(await estadoDaBase()).toEqual({ base: nomeDoWorker(), saloes: 0, migracoes: MIGRACOES, marcador: [1] });
  });

  it('A-2: o template não aceita conexões depois de preparado', async () => {
    const plano = inject('bancoDeTeste');
    const c = new pg.Client({ connectionString: urlComBase(plano.urlTeste, nomesDaExecucao(plano.base, plano.exec).template) });
    await expect(c.connect()).rejects.toThrow(/not currently accepting connections/);
  });

  it('A-1: o template é UTF8 e não é marcado IS_TEMPLATE', async () => {
    const plano = inject('bancoDeTeste');
    const c = await conectar();
    try {
      const r = await c.query<{ enc: string; tpl: boolean; conn: boolean }>(
        `SELECT pg_encoding_to_char(encoding) AS enc, datistemplate AS tpl, datallowconn AS conn
         FROM pg_database WHERE datname = $1`,
        [nomesDaExecucao(plano.base, plano.exec).template],
      );
      expect(r.rows).toEqual([{ enc: 'UTF8', tpl: false, conn: false }]);
    } finally {
      await c.end();
    }
  });
});
