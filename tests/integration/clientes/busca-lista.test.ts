import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listar } from '@/server/clientes/servico';
import { chaveDeBusca } from '@/server/clientes/validacao';
import { AcessoNegado } from '@/server/tenant/erros';

import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { anonimizarPorSql, ctxDoGestor, ctxDoProfissional, inserirCliente } from './apoio';

// D-022 T-5: lista, busca e paginação contra PostgreSQL real. CA-4, CA-7, CA-8, CA-9, R-5.

let c: pg.Client;
let s: SalaoCompleto;
let outro: SalaoCompleto;

const nomes = async (q: unknown, pagina?: unknown) => (await listar(ctxDoGestor(s), { q, pagina })).itens.map((i) => i.nome);

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto({ cliente: { nome: 'Zélia', telefoneE164: '+5531988887777' } });
  await inserirCliente(c, s.salaoId, 'Ana Júlia', '+5511987654321');
  await inserirCliente(c, s.salaoId, 'ANA CLARA', '+5521991234567');
  await inserirCliente(c, s.salaoId, 'João_%', '+551134567890');
  outro = (await criarDoisSaloes()).b;
});
afterAll(async () => {
  await c.end();
});

describe('CA-8: busca por nome e telefone, ordem e literais', () => {
  it('sem busca: ordem por nome normalizado (acento não afeta), anonimizada fora, total só das ativas', async () => {
    const l = await listar(ctxDoGestor(s), {});
    expect(l.itens.map((i) => i.nome)).toEqual(['ANA CLARA', 'Ana Júlia', 'João_%', 'Zélia']);
    expect(l).toMatchObject({ total: 4, pagina: 1, porPagina: 20, q: '' });
    expect(l.itens[1]).toMatchObject({ telefone: '+5511987654321', telefoneFormatado: '(11) 98765-4321', anonimizada: false });
  });

  it.each([
    ['ana', ['ANA CLARA', 'Ana Júlia']],
    ['julia', ['Ana Júlia']],
    ['JÚLIA', ['Ana Júlia']],
    ['zelia', ['Zélia']],
    ['ZÉLIA', ['Zélia']],
    ['a c', ['ANA CLARA']],
    ['  a    c  ', ['ANA CLARA']],
    ['%', ['João_%']],
    ['_', ['João_%']],
    ['\\', []],
    ['joao_%', ['João_%']],
    ['98765', ['Ana Júlia']],
    ['(11) 98765', ['Ana Júlia']],
    ['+55 11 9', ['Ana Júlia']],
    ['5511987654321', ['Ana Júlia']],
    ['987654321', ['Ana Júlia']],
    ['xyz', []],
    ['12', []],
  ])('q=%j → %j', async (q, esperado) => {
    expect(await nomes(q)).toEqual(esperado);
  });

  it('nenhuma encontrada: total 0 e página 1 sem itens', async () => {
    expect(await listar(ctxDoGestor(s), { q: 'xyz' })).toMatchObject({ itens: [], total: 0, pagina: 1, q: 'xyz' });
  });

  it('q gigante é cortado em 80 sem erro; objeto/array não quebram', async () => {
    const l = await listar(ctxDoGestor(s), { q: 'a'.repeat(5000) });
    expect(l.q).toHaveLength(80);
    expect(await nomes({})).toHaveLength(4);
    expect(await nomes(['ana'])).toHaveLength(4);
    expect(await nomes('ana\u0000x')).toEqual([]);
  });

  it('só o gestor lista: o profissional recebe AcessoNegado', async () => {
    await expect(listar(ctxDoProfissional(s), {})).rejects.toBeInstanceOf(AcessoNegado);
  });
});

describe('CA-7: anonimizada nunca aparece', () => {
  it('fora da lista, da busca e do total', async () => {
    const t = await criarSalaoCompleto({ cliente: { nome: 'Dora', telefoneE164: '+5511900001111' } });
    const l = await listar(ctxDoGestor(t), {});
    expect(l.total).toBe(1);
    expect(l.itens.map((i) => i.id)).toEqual([t.clientes.ativaId]);
    expect(l.itens.some((i) => i.id === t.clientes.anonimizadaId)).toBe(false);
    // anonimiza a única ativa: lista vazia
    await anonimizarPorSql(c, t.clientes.ativaId);
    expect(await listar(ctxDoGestor(t), {})).toMatchObject({ itens: [], total: 0 });
    expect(await listar(ctxDoGestor(t), { q: 'dora' })).toMatchObject({ itens: [], total: 0 });
  });
});

describe('CA-9: paginação', () => {
  let p: SalaoCompleto;
  beforeAll(async () => {
    p = await criarSalaoCompleto({ cliente: { nome: 'Maria', telefoneE164: '+5511900000000' } });
    // 45 ativas no total: nomes repetidos para exercitar o desempate por id.
    await c.query(
      `INSERT INTO cliente (salao_id, nome, telefone_e164)
       SELECT $1, CASE WHEN g % 3 = 0 THEN 'Maria' ELSE 'Cliente ' || (g % 7) END, '+5511900' || lpad(g::text, 6, '0')
         FROM generate_series(1, 44) g`,
      [p.salaoId],
    );
  });

  const pagina = (v: unknown) => listar(ctxDoGestor(p), { pagina: v });

  it('1, 2 e 3 trazem 20, 20 e 5; a 4 é vazia; total 45; sem repetir nem omitir', async () => {
    const ids: string[] = [];
    for (const [n, esperado] of [['1', 20], ['2', 20], ['3', 5], ['4', 0]] as const) {
      const l = await pagina(n);
      expect(l.total).toBe(45);
      expect(l.itens).toHaveLength(esperado);
      expect(l.pagina).toBe(Number(n));
      ids.push(...l.itens.map((i) => i.id));
    }
    expect(new Set(ids).size).toBe(45);
    const { rows } = await c.query<{ n: string }>('SELECT count(*) AS n FROM cliente WHERE salao_id = $1 AND anonimizada_em IS NULL', [p.salaoId]);
    expect(Number(rows[0].n)).toBe(45);
  });

  it('ordem: nome normalizado e depois id, estável entre as páginas', async () => {
    const todos = [...(await pagina('1')).itens, ...(await pagina('2')).itens, ...(await pagina('3')).itens];
    const chaves = todos.map((i) => [chaveDeBusca(i.nome ?? ''), i.id] as const);
    const ordenado = [...chaves].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
    expect(chaves).toEqual(ordenado);
  });

  it.each(['0', '-1', 'abc', '1.5', '99999999999999999999', undefined, ''])('página %j cai na 1', async (v) => {
    const l = await pagina(v);
    expect(l.pagina).toBe(1);
    expect(l.itens).toHaveLength(20);
  });

  it('página enorme no formato aceito: vazia, sem erro, total preservado', async () => {
    expect(await pagina('9999999')).toMatchObject({ itens: [], total: 45, pagina: 9999999 });
  });
});

describe('CA-4: isolamento na lista e na busca', () => {
  it('cada gestor vê só as próprias clientes, também por telefone', async () => {
    await inserirCliente(c, outro.salaoId, 'Ana Do Outro', '+5511987654321');
    const a = await listar(ctxDoGestor(s), { q: '98765' });
    expect(a.itens.map((i) => i.nome)).toEqual(['Ana Júlia']);
    const b = await listar(ctxDoGestor(outro), { q: '98765' });
    expect(b.itens.map((i) => i.nome)).toEqual(['Ana Do Outro']);
    expect((await listar(ctxDoGestor(outro), { q: 'zelia' })).total).toBe(0);
  });
});

describe('R-5: paridade da normalização JS × SQL', () => {
  const TEXTOS = [
    'Ana Júlia',
    'ANA CLARA',
    'Zélia',
    'João_%',
    'Ça va Ñandú',
    'ÇÃO',
    'straße',
    'Ǆ',
    'İstanbul',
    'Åsa Øre',
    'Łukasz',
    'Æon',
    'école',
    'ÉCOLE',
    '  espaços  ',
    '12345',
    '',
    '日本語 テスト',
    '😀 emoji',
    'ŉ ǰ ǅ',
  ];

  it('chaveDeBusca (JS) = lower(regexp_replace(normalize(x, NFD), faixa U+0300..U+036F)) (SQL)', async () => {
    for (const t of TEXTOS) {
      const { rows } = await c.query<{ k: string }>(
        `SELECT lower(regexp_replace(normalize($1::text, NFD), '[\\u0300-\\u036f]', '', 'g')) AS k`,
        [t],
      );
      expect(chaveDeBusca(t), JSON.stringify(t)).toBe(rows[0].k);
    }
  });

  it('a consulta do repositório acha cada nome pela própria chave (ida e volta pelo banco)', async () => {
    const t = await criarSalaoCompleto({ cliente: { nome: 'Base', telefoneE164: '+5511900002222' } });
    const unicos = TEXTOS.filter((x) => x.trim().length >= 2 && !/[\p{Cc}]/u.test(x));
    for (const [i, nome] of unicos.entries()) {
      await inserirCliente(c, t.salaoId, nome.trim().replace(/\s+/g, ' '), `+5511900${String(i + 10).padStart(6, '0')}`);
    }
    for (const nome of unicos) {
      const limpo = nome.trim().replace(/\s+/g, ' ');
      const l = await listar(ctxDoGestor(t), { q: limpo });
      expect(l.itens.map((x) => x.nome), JSON.stringify(limpo)).toContain(limpo);
    }
  });
});
