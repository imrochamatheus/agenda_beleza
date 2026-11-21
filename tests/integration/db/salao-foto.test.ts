import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarSalao, erroSql } from '../../support/sql';

// D-021 (E2.7), migração 20261121000000_salao_foto. Contrato em docs/demandas/D-021/dba.md.
// CA-1 (formato da chave), CA-3 (12 posições, a 13ª recusada), CA-6 (compactação), CA-8 (troca de vizinhas),
// CA-13 (token único por salão) e a ordem de travas salao FOR NO KEY UPDATE -> salao_foto.
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

const chaveNova = () => `fotos/${randomUUID().replaceAll('-', '')}abcdefghij.webp`;

type Campos = { chave: string; alt: string; posicao: number; largura: number; altura: number; bytes: number; envio: string };

function dados(sobrescrever: Partial<Campos> = {}): Campos {
  return { chave: chaveNova(), alt: 'Recepção do salão', posicao: 1, largura: 800, altura: 600, bytes: 1000, envio: randomUUID(), ...sobrescrever };
}

function inserir(cl: pg.Client, salaoId: string, d: Campos) {
  return cl.query(
    `INSERT INTO salao_foto (salao_id, chave, alt, posicao, largura, altura, bytes, envio)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [salaoId, d.chave, d.alt, d.posicao, d.largura, d.altura, d.bytes, d.envio],
  );
}

async function posicoes(salaoId: string): Promise<number[]> {
  const r = await c.query<{ posicao: number }>('SELECT posicao FROM salao_foto WHERE salao_id = $1 ORDER BY posicao', [salaoId]);
  return r.rows.map((x) => x.posicao);
}

async function salaoComFotos(n: number): Promise<{ salaoId: string; ids: string[] }> {
  const salaoId = await criarSalao(c);
  const ids: string[] = [];
  for (let p = 1; p <= n; p++) ids.push((await inserir(c, salaoId, dados({ posicao: p }))).rows[0].id);
  return { salaoId, ids };
}

describe('CHECKs de defesa', () => {
  it('aceita uma foto válida; recusa cada violação com o nome da constraint', async () => {
    const salaoId = await criarSalao(c);
    await inserir(c, salaoId, dados());
    const casos: [string, Partial<Campos>][] = [
      ['salao_foto_posicao_chk', { posicao: 0 }],
      ['salao_foto_posicao_chk', { posicao: 13 }],
      ['salao_foto_dimensoes_chk', { largura: 0 }],
      ['salao_foto_dimensoes_chk', { altura: 1601 }],
      ['salao_foto_bytes_chk', { bytes: 0 }],
      ['salao_foto_alt_chk', { alt: '' }],
      ['salao_foto_alt_chk', { alt: ' com espaço' }],
      ['salao_foto_alt_chk', { alt: 'com espaço ' }],
      ['salao_foto_alt_chk', { alt: 'a'.repeat(151) }],
      ['salao_foto_chave_chk', { chave: 'fotos/curta.webp' }],
      ['salao_foto_chave_chk', { chave: `outra/${randomUUID().replaceAll('-', '')}abcdefghij.webp` }],
      ['salao_foto_chave_chk', { chave: `fotos/${randomUUID().replaceAll('-', '')}abcdefghij.png` }],
      ['salao_foto_chave_chk', { chave: `fotos/../${randomUUID().replaceAll('-', '')}abcdefghij.webp` }],
    ];
    for (const [nome, d] of casos) {
      const e = await erroSql(inserir(c, salaoId, dados({ posicao: 2, ...d })));
      expect(e, JSON.stringify(d)).toMatchObject({ code: '23514', constraint: nome });
    }
  });

  it('aceita os limites: 150 caracteres de alt, 1600x1600 e posições 1..12 (CA-3: a 13ª é recusada)', async () => {
    const salaoId = await criarSalao(c);
    await inserir(c, salaoId, dados({ posicao: 1, alt: 'a'.repeat(150), largura: 1600, altura: 1600, bytes: 2_000_000_000 }));
    for (let p = 2; p <= 12; p++) await inserir(c, salaoId, dados({ posicao: p }));
    expect(await posicoes(salaoId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(await erroSql(inserir(c, salaoId, dados({ posicao: 13 })))).toMatchObject({ constraint: 'salao_foto_posicao_chk' });
  });
});

describe('unicidades e FK', () => {
  it('chave única entre salões; (salao_id, envio) único por salão mas repetível em outro salão (CA-13)', async () => {
    const a = await criarSalao(c);
    const b = await criarSalao(c);
    const d = dados();
    await inserir(c, a, d);
    expect(await erroSql(inserir(c, b, dados({ chave: d.chave })))).toMatchObject({
      code: '23505',
      constraint: 'salao_foto_chave_key',
    });
    expect(await erroSql(inserir(c, a, dados({ posicao: 2, envio: d.envio })))).toMatchObject({
      code: '23505',
      constraint: 'salao_foto_salao_id_envio_key',
    });
    await inserir(c, b, dados({ envio: d.envio }));
  });

  it('posição repetida: 23505 só no COMMIT (constraint adiada); ROLLBACK implícito', async () => {
    const { salaoId } = await salaoComFotos(1);
    await c.query('BEGIN');
    await inserir(c, salaoId, dados({ posicao: 1 })); // não falha no comando
    const e = await erroSql(c.query('COMMIT'));
    expect(e).toMatchObject({ code: '23505', constraint: 'salao_foto_posicao_unica' });
    await c.query('ROLLBACK').catch(() => undefined);
    expect(await posicoes(salaoId)).toEqual([1]);
  });

  it('a mesma posição em salões diferentes é permitida', async () => {
    await salaoComFotos(2);
    await salaoComFotos(2);
  });

  it('FK RESTRICT: apagar um salão com fotos falha (23503)', async () => {
    const { salaoId } = await salaoComFotos(1);
    expect(await erroSql(c.query('DELETE FROM salao WHERE id = $1', [salaoId]))).toMatchObject({ code: '23503' });
  });

  it('FK: foto de salão inexistente é recusada (23503)', async () => {
    expect(await erroSql(inserir(c, randomUUID(), dados()))).toMatchObject({ code: '23503' });
  });
});

describe('operações do RepoFoto sob a constraint adiada', () => {
  it('troca de vizinhas em um UPDATE ... CASE passa (CA-8)', async () => {
    const { salaoId, ids } = await salaoComFotos(4);
    await c.query('BEGIN');
    await c.query(
      `UPDATE salao_foto SET posicao = CASE id WHEN $2::uuid THEN 3 ELSE 2 END
       WHERE salao_id = $1 AND id IN ($2::uuid, $3::uuid)`,
      [salaoId, ids[1], ids[2]],
    );
    await c.query('COMMIT');
    const r = await c.query<{ id: string }>('SELECT id FROM salao_foto WHERE salao_id = $1 ORDER BY posicao', [salaoId]);
    expect(r.rows.map((x) => x.id)).toEqual([ids[0], ids[2], ids[1], ids[3]]);
  });

  it('DELETE + UPDATE posicao - 1 na mesma transação compacta sem 23505 (CA-6)', async () => {
    const { salaoId, ids } = await salaoComFotos(5);
    await c.query('BEGIN');
    const del = await c.query<{ posicao: number }>('DELETE FROM salao_foto WHERE salao_id = $1 AND id = $2 RETURNING posicao', [
      salaoId,
      ids[1],
    ]);
    await c.query('UPDATE salao_foto SET posicao = posicao - 1 WHERE salao_id = $1 AND posicao > $2', [salaoId, del.rows[0].posicao]);
    await c.query('COMMIT');
    expect(await posicoes(salaoId)).toEqual([1, 2, 3, 4]);
  });

  it('o UPDATE posicao - 1 sem DELETE antes falha no commit (a constraint protege de verdade)', async () => {
    const { salaoId } = await salaoComFotos(3);
    await c.query('BEGIN');
    await c.query('UPDATE salao_foto SET posicao = posicao - 1 WHERE salao_id = $1 AND posicao > 1', [salaoId]);
    expect(await erroSql(c.query('COMMIT'))).toMatchObject({ code: '23505' });
    await c.query('ROLLBACK').catch(() => undefined);
    expect(await posicoes(salaoId)).toEqual([1, 2, 3]);
  });
});

describe('travas', () => {
  async function comTimeout(fn: (a: pg.Client, b: pg.Client) => Promise<void>) {
    const a = await conectar();
    const b = await conectar();
    try {
      await b.query("SET lock_timeout = '500ms'");
      await fn(a, b);
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      await b.query('ROLLBACK').catch(() => undefined);
      await a.end();
      await b.end();
    }
  }

  it('INSERT em salao_foto não espera o FOR NO KEY UPDATE de outra transação no salão; a segunda trava do salão espera', async () => {
    const salaoId = await criarSalao(c);
    await comTimeout(async (a, b) => {
      await a.query('BEGIN');
      await a.query('SELECT 1 FROM salao WHERE id = $1 FOR NO KEY UPDATE', [salaoId]);
      await b.query('BEGIN');
      await inserir(b, salaoId, dados()); // FOR KEY SHARE na FK: compatível
      expect(await erroSql(b.query('SELECT 1 FROM salao WHERE id = $1 FOR NO KEY UPDATE', [salaoId]))).toMatchObject({
        code: '55P03',
      });
    });
  });

  it('INSERTs concorrentes em salões diferentes não se bloqueiam', async () => {
    const s1 = await criarSalao(c);
    const s2 = await criarSalao(c);
    await comTimeout(async (a, b) => {
      await a.query('BEGIN');
      await inserir(a, s1, dados());
      await b.query('BEGIN');
      await inserir(b, s2, dados());
      await a.query('COMMIT');
      await b.query('COMMIT');
    });
  });

  it('a mesma posição inserida em paralelo no mesmo salão: a segunda falha no commit, sem impasse', async () => {
    const salaoId = await criarSalao(c);
    await comTimeout(async (a, b) => {
      await a.query('BEGIN');
      await b.query('BEGIN');
      await inserir(a, salaoId, dados({ posicao: 1 }));
      await inserir(b, salaoId, dados({ posicao: 1 }));
      await a.query('COMMIT');
      expect(await erroSql(b.query('COMMIT'))).toMatchObject({ code: '23505', constraint: 'salao_foto_posicao_unica' });
    });
  });
});
