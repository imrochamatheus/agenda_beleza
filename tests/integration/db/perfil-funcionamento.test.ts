import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarProfissional, criarSalao, erroSql } from '../../support/sql';

// D-020 (E2.6), migração 20261120000000_perfil_funcionamento. Contrato em docs/demandas/D-020/dba.md §2.
// CA-3 (faixa e sobreposição no banco), CA-6 (salão novo/legado: perfil vazio, "não informado", sem linhas),
// CA-14 (NULL e nunca ''; listas vazias), R-10 (CHECK × validação nos casos-limite) e a pendência 7
// (trava do salão × FOR KEY SHARE das inserções; xmin e IS DISTINCT FROM).
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

const SEGUNDA = 1;
const TERCA = 2;

function inserirFuncionamento(cl: pg.Client, salaoId: string, dia: number, inicio: number, fim: number) {
  return cl.query(
    'INSERT INTO salao_funcionamento (salao_id, dia_semana, inicio_min, fim_min) VALUES ($1, $2, $3, $4)',
    [salaoId, dia, inicio, fim],
  );
}

async function linhasDe(salaoId: string): Promise<number> {
  const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM salao_funcionamento WHERE salao_id = $1', [
    salaoId,
  ]);
  return r.rows[0].n;
}

/** UPDATE de uma coluna do perfil. `coluna` vem só das listas fixas deste arquivo. */
function definir(salaoId: string, coluna: string, valor: unknown) {
  return c.query(`UPDATE salao SET ${coluna} = $2 WHERE id = $1`, [salaoId, valor]);
}

const ENDERECO_COMPLETO = {
  endereco_logradouro: 'Rua Augusta',
  endereco_numero: '123',
  endereco_bairro: 'Consolação',
  endereco_cidade: 'São Paulo',
  endereco_uf: 'SP',
  endereco_cep: '01310100',
};

function gravarEndereco(salaoId: string, e: Record<string, string | null>) {
  const colunas = Object.keys(e);
  const sets = colunas.map((col, i) => `${col} = $${i + 2}`).join(', ');
  return c.query(`UPDATE salao SET ${sets} WHERE id = $1`, [salaoId, ...colunas.map((col) => e[col])]);
}

describe('CA-6/CA-14: defaults de um salão inserido só com o nome', () => {
  it('perfil todo NULL, listas vazias, funcionamento_definido false e nenhuma linha de funcionamento', async () => {
    const s = await criarSalao(c);
    const r = await c.query(
      `SELECT descricao, endereco_logradouro, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade,
              endereco_uf, endereco_cep, telefone_e164, whatsapp_e164, instagram, meios_pagamento, comodidades,
              funcionamento_definido
       FROM salao WHERE id = $1`,
      [s],
    );
    expect(r.rows).toEqual([
      {
        descricao: null,
        endereco_logradouro: null,
        endereco_numero: null,
        endereco_complemento: null,
        endereco_bairro: null,
        endereco_cidade: null,
        endereco_uf: null,
        endereco_cep: null,
        telefone_e164: null,
        whatsapp_e164: null,
        instagram: null,
        meios_pagamento: [],
        comodidades: [],
        funcionamento_definido: false,
      },
    ]);
    expect(await linhasDe(s)).toBe(0);
  });

  it.each(['meios_pagamento', 'comodidades', 'funcionamento_definido'])(
    '%s = NULL é rejeitado (23502)',
    async (coluna) => {
      const s = await criarSalao(c);
      expect((await erroSql(definir(s, coluna, null))).code).toBe('23502');
    },
  );
});

describe('CA-3: salao_funcionamento (faixa, dia e sobreposição por salão e dia)', () => {
  it('intervalo sobreposto no mesmo salão e dia é rejeitado (23P01)', async () => {
    const s = await criarSalao(c);
    await inserirFuncionamento(c, s, SEGUNDA, 540, 720);
    expect(await erroSql(inserirFuncionamento(c, s, SEGUNDA, 600, 800))).toEqual({
      code: '23P01',
      constraint: 'salao_funcionamento_sem_sobreposicao',
    });
    expect(await erroSql(inserirFuncionamento(c, s, SEGUNDA, 540, 720))).toEqual({
      code: '23P01',
      constraint: 'salao_funcionamento_sem_sobreposicao',
    });
    expect(await linhasDe(s)).toBe(1);
  });

  it('contíguos no mesmo dia, o mesmo intervalo em outro dia e o dia inteiro são aceitos', async () => {
    const s = await criarSalao(c);
    await inserirFuncionamento(c, s, SEGUNDA, 540, 720);
    await inserirFuncionamento(c, s, SEGUNDA, 720, 1080);
    await inserirFuncionamento(c, s, TERCA, 540, 720);
    await inserirFuncionamento(c, s, 0, 0, 1440);
    await inserirFuncionamento(c, s, 6, 1320, 1440);
    expect(await linhasDe(s)).toBe(5);
  });

  it('outro salão pode ter o mesmo intervalo no mesmo dia', async () => {
    const s1 = await criarSalao(c);
    const s2 = await criarSalao(c);
    await inserirFuncionamento(c, s1, SEGUNDA, 540, 720);
    await inserirFuncionamento(c, s2, SEGUNDA, 540, 720);
    expect(await linhasDe(s2)).toBe(1);
  });

  it.each([
    ['inicio_min = fim_min', 720, 720],
    ['inicio_min > fim_min', 800, 700],
    ['fim_min > 1440', 1000, 1441],
    ['inicio_min < 0', -1, 60],
  ])('%s é rejeitado pelo CHECK de faixa (23514)', async (_caso, inicio, fim) => {
    const s = await criarSalao(c);
    expect(await erroSql(inserirFuncionamento(c, s, SEGUNDA, inicio, fim))).toEqual({
      code: '23514',
      constraint: 'salao_funcionamento_faixa_chk',
    });
    expect(await linhasDe(s)).toBe(0);
  });

  it.each([-1, 7])('dia_semana %i é rejeitado pelo CHECK (23514)', async (dia) => {
    const s = await criarSalao(c);
    expect(await erroSql(inserirFuncionamento(c, s, dia, 540, 720))).toEqual({
      code: '23514',
      constraint: 'salao_funcionamento_dia_semana_chk',
    });
  });

  it('FK RESTRICT: salão inexistente é rejeitado e o salão com funcionamento não pode ser apagado (23503)', async () => {
    expect(await erroSql(inserirFuncionamento(c, '00000000-0000-4000-8000-000000000000', SEGUNDA, 540, 720))).toEqual({
      code: '23503',
      constraint: 'salao_funcionamento_salao_id_fkey',
    });
    const s = await criarSalao(c);
    await inserirFuncionamento(c, s, SEGUNDA, 540, 720);
    expect(await erroSql(c.query('DELETE FROM salao WHERE id = $1', [s]))).toEqual({
      code: '23503',
      constraint: 'salao_funcionamento_salao_id_fkey',
    });
  });

  it('A-4: DELETE seguido de INSERT do mesmo intervalo na mesma transação é aceito', async () => {
    const s = await criarSalao(c);
    await inserirFuncionamento(c, s, SEGUNDA, 540, 720);
    await c.query('BEGIN');
    try {
      await c.query('DELETE FROM salao_funcionamento WHERE salao_id = $1', [s]);
      await inserirFuncionamento(c, s, SEGUNDA, 600, 780);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
    expect(await linhasDe(s)).toBe(1);
  });
});

describe('CA-14/R-10: CHECKs de texto do perfil (NULL ou forma normalizada)', () => {
  const UMA_LINHA: [string, number][] = [
    ['endereco_logradouro', 120],
    ['endereco_numero', 10],
    ['endereco_complemento', 60],
    ['endereco_bairro', 80],
    ['endereco_cidade', 80],
  ];

  describe.each(UMA_LINHA)('%s (até %i caracteres, uma linha)', (coluna, max) => {
    const chk = `salao_${coluna}_chk`;
    // Parte de um endereço completo, para que só o CHECK da coluna sob teste possa falhar (e não o "tudo ou nada").
    async function salaoComEndereco(): Promise<string> {
      const s = await criarSalao(c);
      await gravarEndereco(s, ENDERECO_COMPLETO);
      return s;
    }

    it('aceita o limite exato, acentos e espaço interno', async () => {
      const s = await salaoComEndereco();
      await definir(s, coluna, 'á'.repeat(max));
      await definir(s, coluna, 'Sé 2');
      const r = await c.query(`SELECT ${coluna} AS v FROM salao WHERE id = $1`, [s]);
      expect(r.rows[0].v).toBe('Sé 2');
    });

    it.each([
      ['acima do limite', 'a'.repeat(max + 1)],
      ['vazio', ''],
      ['só espaço', ' '],
      ['espaço no início', ' a'],
      ['espaço no fim', 'a '],
      ['quebra de linha', 'a\nb'],
      ['tabulação', 'a\tb'],
      ['controle C1 (U+0085)', 'a\u0085b'],
      ['DEL (U+007F)', 'a\u007fb'],
    ])('rejeita %s (23514)', async (_caso, valor) => {
      const s = await salaoComEndereco();
      expect(await erroSql(definir(s, coluna, valor))).toEqual({
        code: '23514',
        constraint: chk,
      });
    });
  });

  it('numero aceita s/n', async () => {
    const s = await criarSalao(c);
    await gravarEndereco(s, { ...ENDERECO_COMPLETO, endereco_numero: 's/n' });
    const r = await c.query('SELECT endereco_numero AS v FROM salao WHERE id = $1', [s]);
    expect(r.rows[0].v).toBe('s/n');
  });

  it('descricao: aceita 1.000 caracteres, quebras internas e 1.000 code points fora do BMP (a aplicação é mais estrita)', async () => {
    const s = await criarSalao(c);
    await definir(s, 'descricao', 'a'.repeat(1000));
    await definir(s, 'descricao', 'Primeira linha\n\nSegunda linha');
    // 1.000 emojis = 1.000 code points (char_length) e 2.000 unidades UTF-16: o banco aceita, a aplicação recusa.
    await definir(s, 'descricao', '\u{1F487}'.repeat(1000));
    const r = await c.query<{ n: number }>('SELECT char_length(descricao)::int AS n FROM salao WHERE id = $1', [s]);
    expect(r.rows[0].n).toBe(1000);
  });

  it.each([
    ['1.001 caracteres', 'a'.repeat(1001)],
    ['vazia', ''],
    ['só quebras e espaços', ' \n '],
    ['quebra no início', '\nabc'],
    ['espaço no fim', 'abc '],
    ['tabulação', 'a\tb'],
    ['\\r', 'a\r\nb'],
    ['controle C1 (U+0085)', 'a\u0085b'],
  ])('descricao: rejeita %s (23514)', async (_caso, valor) => {
    const s = await criarSalao(c);
    expect(await erroSql(definir(s, 'descricao', valor))).toEqual({
      code: '23514',
      constraint: 'salao_descricao_chk',
    });
  });

  it('uf: aceita as 27 siglas', async () => {
    const s = await criarSalao(c);
    for (const uf of [
      'AC',
      'AL',
      'AP',
      'AM',
      'BA',
      'CE',
      'DF',
      'ES',
      'GO',
      'MA',
      'MT',
      'MS',
      'MG',
      'PA',
      'PB',
      'PR',
      'PE',
      'PI',
      'RJ',
      'RN',
      'RS',
      'RO',
      'RR',
      'SC',
      'SP',
      'SE',
      'TO',
    ]) {
      expect((await gravarEndereco(s, { ...ENDERECO_COMPLETO, endereco_uf: uf })).rowCount).toBe(1);
    }
  });

  it.each(['sp', 'XX', 'S', 'SPP', ''])('uf: rejeita %j (23514)', async (uf) => {
    const s = await criarSalao(c);
    expect(await erroSql(gravarEndereco(s, { ...ENDERECO_COMPLETO, endereco_uf: uf }))).toEqual({
      code: '23514',
      constraint: 'salao_endereco_uf_chk',
    });
  });

  it.each(['01310-100', '00000000', '1310100', '013101000', 'abcdefgh', ''])('cep: rejeita %j (23514)', async (cep) => {
    const s = await criarSalao(c);
    expect(await erroSql(gravarEndereco(s, { ...ENDERECO_COMPLETO, endereco_cep: cep }))).toEqual({
      code: '23514',
      constraint: 'salao_endereco_cep_chk',
    });
  });

  describe.each(['telefone_e164', 'whatsapp_e164'])('%s (mesma expressão de cliente_telefone_e164_chk)', (coluna) => {
    it.each(['+5511987654321', '+551134567890', '+5599999999999'])('aceita %s', async (v) => {
      const s = await criarSalao(c);
      expect((await definir(s, coluna, v)).rowCount).toBe(1);
    });

    it.each(['', '11987654321', '5511987654321', '+5501987654321', '+55119876543', '+55119876543210', '+1 2025550123'])(
      'rejeita %j (23514)',
      async (v) => {
        const s = await criarSalao(c);
        expect(await erroSql(definir(s, coluna, v))).toEqual({
          code: '23514',
          constraint: `salao_${coluna}_chk`,
        });
      },
    );
  });

  it.each(['meusalao', 'meu.salao_1', 'a', '_', 'a'.repeat(30)])('instagram: aceita %s', async (v) => {
    const s = await criarSalao(c);
    expect((await definir(s, 'instagram', v)).rowCount).toBe(1);
  });

  it.each(['', '@meusalao', 'MeuSalao', 'a'.repeat(31), '.salao', 'salao.', 'meu..salao', 'meu-salao', 'meu salao'])(
    'instagram: rejeita %j (23514)',
    async (v) => {
      const s = await criarSalao(c);
      expect(await erroSql(definir(s, 'instagram', v))).toEqual({
        code: '23514',
        constraint: 'salao_instagram_chk',
      });
    },
  );
});

describe('RN-6: endereço tudo ou nada (salao_endereco_completo_chk)', () => {
  it('aceita os 6 obrigatórios, com e sem complemento, e volta a vazio com tudo NULL', async () => {
    const s = await criarSalao(c);
    expect((await gravarEndereco(s, ENDERECO_COMPLETO)).rowCount).toBe(1);
    expect(
      (
        await gravarEndereco(s, {
          ...ENDERECO_COMPLETO,
          endereco_complemento: 'Sala 2',
        })
      ).rowCount,
    ).toBe(1);
    await gravarEndereco(s, {
      endereco_logradouro: null,
      endereco_numero: null,
      endereco_complemento: null,
      endereco_bairro: null,
      endereco_cidade: null,
      endereco_uf: null,
      endereco_cep: null,
    });
    const r = await c.query(
      'SELECT num_nonnulls(endereco_logradouro, endereco_complemento, endereco_cep)::int AS n FROM salao WHERE id = $1',
      [s],
    );
    expect(r.rows[0].n).toBe(0);
  });

  it.each(Object.keys(ENDERECO_COMPLETO))('rejeita o endereço sem %s (23514)', async (faltante) => {
    const s = await criarSalao(c);
    expect(await erroSql(gravarEndereco(s, { ...ENDERECO_COMPLETO, [faltante]: null }))).toEqual({
      code: '23514',
      constraint: 'salao_endereco_completo_chk',
    });
  });

  it('rejeita um campo obrigatório sozinho e o complemento sem endereço (23514)', async () => {
    const s = await criarSalao(c);
    expect(await erroSql(definir(s, 'endereco_cidade', 'São Paulo'))).toEqual({
      code: '23514',
      constraint: 'salao_endereco_completo_chk',
    });
    expect(await erroSql(definir(s, 'endereco_complemento', 'Sala 2'))).toEqual({
      code: '23514',
      constraint: 'salao_endereco_completo_chk',
    });
  });
});

describe('D-8: listas do perfil (sem CHECK de valores; sem NULL; até 20 itens)', () => {
  it.each(['meios_pagamento', 'comodidades'])('%s aceita vazia, chave desconhecida e 20 itens', async (coluna) => {
    const s = await criarSalao(c);
    await definir(s, coluna, []);
    await definir(s, coluna, ['pix', 'cheque']);
    await definir(
      s,
      coluna,
      Array.from({ length: 20 }, (_, i) => `k${i}`),
    );
    const r = await c.query(`SELECT cardinality(${coluna})::int AS n FROM salao WHERE id = $1`, [s]);
    expect(r.rows[0].n).toBe(20);
  });

  it.each([
    ['meios_pagamento', 'elemento NULL', ['pix', null]],
    ['meios_pagamento', '21 itens', Array.from({ length: 21 }, (_, i) => `k${i}`)],
    ['comodidades', 'elemento NULL', [null]],
    ['comodidades', '21 itens', Array.from({ length: 21 }, (_, i) => `k${i}`)],
  ])('%s rejeita %s (23514)', async (coluna, _caso, valor) => {
    const s = await criarSalao(c);
    expect(await erroSql(definir(s, coluna, valor))).toEqual({
      code: '23514',
      constraint: `salao_${coluna}_chk`,
    });
  });
});

describe('pendência 7: travas, xmin e IS DISTINCT FROM', () => {
  async function emTransacao<T>(cl: pg.Client, f: () => Promise<T>): Promise<T> {
    await cl.query('BEGIN');
    try {
      return await f();
    } finally {
      await cl.query('ROLLBACK');
    }
  }

  it('com salao FOR NO KEY UPDATE em T1, as inserções com FK (funcionamento, jornada) de T2 não esperam; o UPDATE do estado espera', async () => {
    const s = await criarSalao(c);
    const p = await criarProfissional(c, s);
    const t2 = await conectar();
    try {
      await emTransacao(c, async () => {
        await c.query('SELECT funcionamento_definido FROM salao WHERE id = $1 FOR NO KEY UPDATE', [s]);
        await emTransacao(t2, async () => {
          await t2.query(`SET LOCAL lock_timeout = '500ms'`);
          await inserirFuncionamento(t2, s, SEGUNDA, 540, 720);
          await t2.query(
            'INSERT INTO jornada (salao_id, profissional_id, dia_semana, inicio_min, fim_min) VALUES ($1, $2, 1, 540, 720)',
            [s, p],
          );
          expect(
            (
              await erroSql(
                t2.query('UPDATE salao SET funcionamento_definido = true, atualizado_em = now() WHERE id = $1', [s]),
              )
            ).code,
          ).toBe('55P03');
        });
      });
    } finally {
      await t2.end();
    }
  });

  it('com uma inserção de funcionamento pendente em T1 (FOR KEY SHARE), o UPDATE do estado em T2 não espera', async () => {
    const s = await criarSalao(c);
    const t2 = await conectar();
    try {
      await emTransacao(c, async () => {
        await inserirFuncionamento(c, s, SEGUNDA, 540, 720);
        await emTransacao(t2, async () => {
          await t2.query(`SET LOCAL lock_timeout = '500ms'`);
          const r = await t2.query(
            `UPDATE salao SET funcionamento_definido = true, atualizado_em = now()
             WHERE id = $1 AND funcionamento_definido IS DISTINCT FROM true`,
            [s],
          );
          expect(r.rowCount).toBe(1);
        });
      });
    } finally {
      await t2.end();
    }
  });

  it('CA-4: FOR NO KEY UPDATE e o UPDATE sem mudança (IS DISTINCT FROM) não mudam xmin nem atualizado_em; a mudança muda', async () => {
    const s = await criarSalao(c);
    const ler = async () =>
      (
        await c.query<{
          xmin: string;
          atualizado_em: string;
          definido: boolean;
        }>(
          'SELECT xmin::text AS xmin, atualizado_em::text AS atualizado_em, funcionamento_definido AS definido FROM salao WHERE id = $1',
          [s],
        )
      ).rows[0];
    const definirEstado = (v: boolean) =>
      c.query(
        `UPDATE salao SET funcionamento_definido = $2, atualizado_em = now()
         WHERE id = $1 AND funcionamento_definido IS DISTINCT FROM $2`,
        [s, v],
      );
    const antes = await ler();
    await c.query('BEGIN');
    await c.query('SELECT funcionamento_definido FROM salao WHERE id = $1 FOR NO KEY UPDATE', [s]);
    expect((await definirEstado(false)).rowCount).toBe(0);
    await c.query('COMMIT');
    expect(await ler()).toEqual(antes);

    expect((await definirEstado(true)).rowCount).toBe(1);
    const depois = await ler();
    expect(depois.definido).toBe(true);
    expect(depois.xmin).not.toBe(antes.xmin);
    expect(depois.atualizado_em).not.toBe(antes.atualizado_em);
  });
});
