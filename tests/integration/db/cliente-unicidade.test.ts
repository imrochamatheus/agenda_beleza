import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarCliente, criarSalao, erroSql, telefoneNovo } from '../support/sql';

// CA-10 e CA-16 (RN-6): unicidade por salão + telefone, anonimização coerente e E.164 BR.
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

async function clientesDoSalao(salaoId: string): Promise<number> {
  const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM cliente WHERE salao_id = $1', [salaoId]);
  return r.rows[0].n;
}

async function anonimizada(salaoId: string): Promise<string> {
  const r = await c.query<{ id: string }>(
    'INSERT INTO cliente (salao_id, anonimizada_em) VALUES ($1, now()) RETURNING id',
    [salaoId],
  );
  return r.rows[0].id;
}

describe('cliente: unicidade e anonimização', () => {
  it('CA-10: o mesmo telefone em salões diferentes é aceito', async () => {
    const tel = telefoneNovo();
    const s1 = await criarSalao(c);
    const s2 = await criarSalao(c);
    await criarCliente(c, s1, tel);
    await criarCliente(c, s2, tel);
    expect(await clientesDoSalao(s1)).toBe(1);
    expect(await clientesDoSalao(s2)).toBe(1);
  });

  it('CA-10: o mesmo telefone no mesmo salão é rejeitado (23505)', async () => {
    const tel = telefoneNovo();
    const s = await criarSalao(c);
    await criarCliente(c, s, tel);
    const erro = await erroSql(criarCliente(c, s, tel));
    expect(erro).toEqual({ code: '23505', constraint: 'cliente_salao_id_telefone_e164_key' });
    expect(await clientesDoSalao(s)).toBe(1);
  });

  it('CA-10: duas clientes anonimizadas no mesmo salão são aceitas (NULLS DISTINCT)', async () => {
    const s = await criarSalao(c);
    await anonimizada(s);
    await anonimizada(s);
    expect(await clientesDoSalao(s)).toBe(2);
  });

  it('CA-10: anonimizada_em preenchido com nome não nulo é rejeitado (23514)', async () => {
    const s = await criarSalao(c);
    const erro = await erroSql(
      c.query("INSERT INTO cliente (salao_id, nome, anonimizada_em) VALUES ($1, 'Ana', now())", [s]),
    );
    expect(erro).toEqual({ code: '23514', constraint: 'cliente_anonimizacao_chk' });
    expect(await clientesDoSalao(s)).toBe(0);
  });

  it('CA-10 (RN-6): cliente não anonimizada sem telefone é rejeitada (23514)', async () => {
    const s = await criarSalao(c);
    const erro = await erroSql(c.query("INSERT INTO cliente (salao_id, nome) VALUES ($1, 'Ana')", [s]));
    expect(erro).toEqual({ code: '23514', constraint: 'cliente_anonimizacao_chk' });
  });
});

describe('cliente: telefone E.164 BR', () => {
  it.each(['+5511987654321', '+551133334444'])('CA-16: %s é aceito', async (tel) => {
    const s = await criarSalao(c);
    await criarCliente(c, s, tel);
    const r = await c.query<{ telefone_e164: string }>('SELECT telefone_e164 FROM cliente WHERE salao_id = $1', [s]);
    expect(r.rows).toEqual([{ telefone_e164: tel }]);
  });

  it.each(['11987654321', '+14155550100', '+5501987654321', '+55119876543210'])(
    'CA-16: %s é rejeitado pelo CHECK (23514)',
    async (tel) => {
      const s = await criarSalao(c);
      const erro = await erroSql(criarCliente(c, s, tel));
      expect(erro).toEqual({ code: '23514', constraint: 'cliente_telefone_e164_chk' });
      expect(await clientesDoSalao(s)).toBe(0);
    },
  );

  it('CA-16: a anonimização é irreversível (repreencher nome e telefone mantendo anonimizada_em é rejeitado)', async () => {
    const s = await criarSalao(c);
    const id = await anonimizada(s);
    const erro = await erroSql(
      c.query("UPDATE cliente SET nome = 'Ana', telefone_e164 = '+5511987654321' WHERE id = $1", [id]),
    );
    expect(erro).toEqual({ code: '23514', constraint: 'cliente_anonimizacao_chk' });
    const r = await c.query('SELECT nome, telefone_e164 FROM cliente WHERE id = $1', [id]);
    expect(r.rows).toEqual([{ nome: null, telefone_e164: null }]);
  });
});
