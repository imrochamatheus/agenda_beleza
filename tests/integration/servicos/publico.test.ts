import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listarServicosPublicos } from '@/server/repos/publico';

import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { ctxPublico, inserirProfissional, inserirServico, vincular } from './apoio';

// D-014 T-2: CA-8 (RN-7). A leitura pública devolve só serviços ativos com ao menos um profissional
// ATIVO vinculado do mesmo salão, só com os campos públicos.

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
afterAll(async () => {
  await c.end();
});

describe('CA-8: listarServicosPublicos (RN-7)', () => {
  it('CA-8: só S1 (ativo com profissional ativo); S2 sem vínculo, S3 só com inativo e S4 inativo ficam de fora', async () => {
    const s = await criarSalaoCompleto();
    // Isola o cenário: desativa os serviços da fábrica.
    await c.query('UPDATE servico SET ativo = false WHERE salao_id = $1', [s.salaoId]);
    const ativo = await inserirProfissional(c, s.salaoId, 'Ativa');
    const inativo = await inserirProfissional(c, s.salaoId, 'Inativa', false);
    const s1 = await inserirServico(c, s.salaoId, { nome: 'S1', precoCentavos: 8000, duracaoMin: 45 });
    const s2 = await inserirServico(c, s.salaoId, { nome: 'S2' });
    const s3 = await inserirServico(c, s.salaoId, { nome: 'S3', precoCentavos: 100, duracaoMin: 5 });
    const s4 = await inserirServico(c, s.salaoId, { nome: 'S4', ativo: false });
    await vincular(c, s.salaoId, s1, ativo);
    await vincular(c, s.salaoId, s3, inativo);
    await vincular(c, s.salaoId, s4, ativo);

    const lista = await listarServicosPublicos(ctxPublico(s));
    expect(lista).toEqual([{ id: s1, nome: 'S1', precoCentavos: 8000, duracaoMin: 45 }]);
    for (const item of lista) {
      expect(Object.keys(item).sort()).toEqual(['duracaoMin', 'id', 'nome', 'precoCentavos']);
    }
    expect(lista.some((x) => x.id === s2 || x.id === s4)).toBe(false);

    // Reativar o profissional de S3 faz S3 aparecer (RN-9: o vínculo foi preservado).
    await c.query('UPDATE profissional SET ativo = true WHERE id = $1', [inativo]);
    expect((await listarServicosPublicos(ctxPublico(s))).map((x) => x.nome)).toEqual(['S1', 'S3']);

    // Reativar S4 também o devolve; desativar o único profissional de S1 o tira.
    await c.query('UPDATE servico SET ativo = true WHERE id = $1', [s4]);
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [ativo]);
    expect((await listarServicosPublicos(ctxPublico(s))).map((x) => x.nome)).toEqual(['S3']);
  });

  it('CA-8: a leitura de B não traz nada de A (e vice-versa); a fábrica continua ofertando os dois ativos', async () => {
    const deA = await listarServicosPublicos(ctxPublico(a));
    const deB = await listarServicosPublicos(ctxPublico(b));
    expect(deA.map((x) => x.id).sort()).toEqual([...a.servicos.ativos].sort());
    expect(deB.map((x) => x.id).sort()).toEqual([...b.servicos.ativos].sort());
  });
});
