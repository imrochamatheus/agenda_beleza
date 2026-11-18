import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarSalao, erroSql } from '../support/sql';

// CA-12 e CA-14 (RN-10): auditoria e assinatura_transicao são somente inserção.
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

type Caso = {
  ca: string;
  tabela: 'auditoria' | 'assinatura_transicao';
  inserir: () => Promise<string>;
  coluna: string;
};

const casos: Caso[] = [
  {
    ca: 'CA-12',
    tabela: 'auditoria',
    coluna: 'acao',
    inserir: async () => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO auditoria (acao, resultado, entidade, antes, depois)
         VALUES ('salao.suspender', 'sucesso', 'salao', '{"suspenso": false}', '{"suspenso": true}') RETURNING id`,
      );
      return r.rows[0].id;
    },
  },
  {
    ca: 'CA-14',
    tabela: 'assinatura_transicao',
    coluna: 'causa',
    inserir: async () => {
      const s = await criarSalao(c);
      const a = await c.query<{ id: string }>('INSERT INTO assinatura (salao_id) VALUES ($1) RETURNING id', [s]);
      const r = await c.query<{ id: string }>(
        "INSERT INTO assinatura_transicao (assinatura_id, de, para, causa) VALUES ($1, 'pendente', 'em_teste', 'cadastro') RETURNING id",
        [a.rows[0].id],
      );
      return r.rows[0].id;
    },
  },
];

describe.each(casos)('$tabela é somente inserção', ({ ca, tabela, inserir, coluna }) => {
  async function linha(id: string): Promise<unknown[]> {
    const r = await c.query(`SELECT * FROM ${tabela} WHERE id = $1`, [id]);
    return r.rows;
  }

  it(`${ca}: INSERT é aceito`, async () => {
    const id = await inserir();
    expect(await linha(id)).toHaveLength(1);
  });

  it(`${ca}: UPDATE é rejeitado com P0001 e o registro continua igual`, async () => {
    const id = await inserir();
    const antes = await linha(id);
    const erro = await erroSql(c.query(`UPDATE ${tabela} SET ${coluna} = 'adulterado' WHERE id = $1`, [id]));
    expect(erro.code).toBe('P0001');
    expect(await linha(id)).toEqual(antes);
  });

  it(`${ca}: DELETE é rejeitado com P0001 e o registro continua igual`, async () => {
    const id = await inserir();
    const antes = await linha(id);
    const erro = await erroSql(c.query(`DELETE FROM ${tabela} WHERE id = $1`, [id]));
    expect(erro.code).toBe('P0001');
    expect(await linha(id)).toEqual(antes);
  });

  it(`${ca}: TRUNCATE é rejeitado com P0001 e a mensagem nomeia a tabela`, async () => {
    const id = await inserir();
    // Em transação com ROLLBACK: se o trigger falhasse, os dados dos outros testes não seriam apagados.
    await c.query('BEGIN');
    let mensagem = '';
    try {
      const erro = await c.query(`TRUNCATE ${tabela}`).then(
        () => null,
        (e: pg.DatabaseError) => e,
      );
      expect(erro?.code).toBe('P0001');
      mensagem = erro?.message ?? '';
    } finally {
      await c.query('ROLLBACK');
    }
    expect(mensagem).toBe(`${tabela} é somente inserção`);
    expect(await linha(id)).toHaveLength(1);
  });
});
