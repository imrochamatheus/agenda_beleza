import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { lerFotosPublicas, listarFotosDoPainel } from '@/server/fotos/leitura';
import { criarArmazenamentoReal } from '@/server/integrations/armazenamento/real';
import { criarPublicoContext } from '@/server/tenant/context';

import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { ACESSO_NEGADO, criarFotos, ctxDoGestor, ctxDoProfissional, inserirFoto } from './apoio';

// D-021 T-7: CA-10 (leitura pública ordenada, conjunto exato de chaves, S3_URL_PUBLICA com cliente injetado).

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
afterEach(async () => {
  await c.query('DELETE FROM salao_foto WHERE salao_id IN ($1, $2)', [a.salaoId, b.salaoId]);
});

const publico = (s: SalaoCompleto) => criarPublicoContext(s.salaoId, s.slugAtual);
const nulo = { send: async () => ({}) };

describe('leitura pública (CA-10)', () => {
  it('exatamente as fotos do salão, na ordem das posições, com só id, url, alt, largura e altura', async () => {
    const fotos = await criarFotos(c, a.salaoId, 3);
    await inserirFoto(c, b.salaoId, { alt: 'de B' });
    const r = await lerFotosPublicas(publico(a));
    expect(r.map((f) => f.id)).toEqual(fotos.map((f) => f.id));
    for (const item of r) expect(Object.keys(item).sort()).toEqual(['alt', 'altura', 'id', 'largura', 'url']);
    for (const f of fotos) expect(JSON.stringify(r)).not.toContain(f.chave);
    expect(JSON.stringify(r)).not.toContain('.webp');
    expect(r.some((f) => f.alt === 'de B')).toBe(false);
  });

  it('salão sem fotos → []', async () => {
    expect(await lerFotosPublicas(publico(b))).toEqual([]);
  });

  it('com S3_URL_PUBLICA (adaptador real, cliente injetado) a url é a do bucket/CDN; sem ela, a rota da app', async () => {
    const [f] = await criarFotos(c, a.salaoId, 1);
    const config = { endpoint: 'https://s3.exemplo.test', regiao: 'auto', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's', pathStyle: true };
    const com = criarArmazenamentoReal({ ...config, urlPublica: 'https://cdn.exemplo.test' }, { cliente: nulo });
    const sem = criarArmazenamentoReal({ ...config, urlPublica: null }, { cliente: nulo });
    expect((await lerFotosPublicas(publico(a), { armazenamento: com }))[0].url).toBe(`https://cdn.exemplo.test/${f.chave}`);
    expect((await lerFotosPublicas(publico(a), { armazenamento: sem }))[0].url).toBe(`/api/fotos/${f.id}`);
  });

  it('listarFotosDoPainel: gestor vê as do salão com posição; profissional → AcessoNegado', async () => {
    await criarFotos(c, a.salaoId, 2);
    const lista = await listarFotosDoPainel(ctxDoGestor(a));
    expect(lista.map((f) => f.posicao)).toEqual([1, 2]);
    await expect(listarFotosDoPainel(ctxDoProfissional(a))).rejects.toMatchObject({ status: ACESSO_NEGADO.status });
  });
});
