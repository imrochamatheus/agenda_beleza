import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { gerarChave } from '@/server/integrations/armazenamento/chave';
import { repos } from '@/server/repos';
import { buscarChaveDaFoto } from '@/server/repos/foto-publica';
import { lerFotosPublicasDoSalao } from '@/server/repos/publico';
import { emTransacao } from '@/server/repos/transacao';
import { criarAdminContext, criarPublicoContext } from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, erroSql } from '../../support/sql';

import { UUID_INEXISTENTE, criarFotos, ctxDoGestor, fotografiaFotos, fotosDe, inserirFoto, posicoesDe } from './apoio';

// D-021 T-6: RepoFoto, leitura pública e busca pré-contexto contra PostgreSQL real, com dois salões.

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

async function limpar(s: SalaoCompleto) {
  await c.query('DELETE FROM salao_foto WHERE salao_id = $1', [s.salaoId]);
}
const novo = (alt = 'Fachada') => ({ chave: gerarChave(), alt, largura: 800, altura: 600, bytes: 1234, envio: randomUUID() });
const sob = <T>(s: SalaoCompleto, fn: (r: ReturnType<typeof repos>, ctx: ContextoEscopado) => Promise<T>) =>
  emTransacao(async (r) => {
    const ctx = ctxDoGestor(s);
    await r.saloes.travar(ctx);
    return fn(r, ctx);
  });

describe('RepoFoto.inserirNoFim e listar', () => {
  it('insere no fim (posições 1..n), lista por posição sem chave', async () => {
    await limpar(a);
    const ctx = ctxDoGestor(a);
    for (const alt of ['A', 'B', 'C']) {
      const r = await sob(a, (rs, x) => rs.fotos.inserirNoFim(x, novo(alt)));
      expect(r.resultado).toBe('criada');
    }
    const lista = await repos().fotos.listar(ctx);
    expect(lista.map((f) => [f.posicao, f.alt])).toEqual([[1, 'A'], [2, 'B'], [3, 'C']]);
    expect(Object.keys(lista[0]).sort()).toEqual(['alt', 'altura', 'id', 'largura', 'posicao']);
    expect(await posicoesDe(c, a.salaoId)).toEqual([1, 2, 3]);
  });

  it('token repetido → duplicado (sem escrita); 12 fotos → limite; a 13ª nunca entra', async () => {
    await limpar(a);
    const d = novo();
    await sob(a, (r, x) => r.fotos.inserirNoFim(x, d));
    expect((await sob(a, (r, x) => r.fotos.inserirNoFim(x, { ...novo(), envio: d.envio }))).resultado).toBe('duplicado');
    for (let i = 0; i < 11; i++) await sob(a, (r, x) => r.fotos.inserirNoFim(x, novo(`F${i}`)));
    expect(await posicoesDe(c, a.salaoId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const antes = await fotografiaFotos(c, a.salaoId);
    expect((await sob(a, (r, x) => r.fotos.inserirNoFim(x, novo()))).resultado).toBe('limite');
    expect(await fotografiaFotos(c, a.salaoId)).toEqual(antes);
  });

  it('prechecar conta e acusa o token; o mesmo token em outro salão é livre', async () => {
    await limpar(a);
    await limpar(b);
    const d = novo();
    await sob(a, (r, x) => r.fotos.inserirNoFim(x, d));
    expect(await repos().fotos.prechecar(ctxDoGestor(a), d.envio)).toEqual({ contagem: 1, tokenExiste: true });
    expect(await repos().fotos.prechecar(ctxDoGestor(a), randomUUID())).toEqual({ contagem: 1, tokenExiste: false });
    expect(await repos().fotos.prechecar(ctxDoGestor(b), d.envio)).toEqual({ contagem: 0, tokenExiste: false });
    expect((await sob(b, (r, x) => r.fotos.inserirNoFim(x, { ...novo(), envio: d.envio }))).resultado).toBe('criada');
  });

  it('o salão vem só do contexto: listar de A não vê as fotos de B', async () => {
    await limpar(a);
    await limpar(b);
    await inserirFoto(c, b.salaoId, { alt: 'de B' });
    expect(await repos().fotos.listar(ctxDoGestor(a))).toEqual([]);
    expect((await repos().fotos.listar(ctxDoGestor(b))).map((f) => f.alt)).toEqual(['de B']);
  });
});

describe('RepoFoto.editarAlt', () => {
  it('altera só o alt; o mesmo texto não escreve (xmin igual); inexistente e de outro salão → NaoEncontrado', async () => {
    await limpar(a);
    await limpar(b);
    const [f] = await criarFotos(c, a.salaoId, 1);
    const fb = await inserirFoto(c, b.salaoId);
    const ctx = ctxDoGestor(a);
    const antes = await fotografiaFotos(c, a.salaoId);
    expect(await repos().fotos.editarAlt(ctx, f.id, f.alt)).toBe('igual');
    expect(await fotografiaFotos(c, a.salaoId)).toEqual(antes);
    expect(await repos().fotos.editarAlt(ctx, f.id, 'Novo texto')).toBe('alterada');
    const [depois] = await fotosDe(c, a.salaoId);
    expect({ ...depois, alt: f.alt }).toEqual(f);
    expect(depois.alt).toBe('Novo texto');

    const antesB = await fotografiaFotos(c, b.salaoId);
    await expect(repos().fotos.editarAlt(ctx, fb.id, 'invasão')).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().fotos.editarAlt(ctx, UUID_INEXISTENTE, 'x')).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().fotos.editarAlt(ctx, 'nao-uuid', 'x')).rejects.toBeInstanceOf(NaoEncontrado);
    expect(await fotografiaFotos(c, b.salaoId)).toEqual(antesB);
  });
});

describe('RepoFoto.trocarComVizinha', () => {
  it('troca com a vizinha, mantém posições 1..n; na ponta e ordem_mudou não escrevem', async () => {
    await limpar(a);
    const [fa, fb, fc] = await criarFotos(c, a.salaoId, 3);
    expect(await sob(a, (r, x) => r.fotos.trocarComVizinha(x, fc.id, 'cima', 3))).toBe('movida');
    expect((await fotosDe(c, a.salaoId)).map((f) => f.id)).toEqual([fa.id, fc.id, fb.id]);
    const antes = await fotografiaFotos(c, a.salaoId);
    expect(await sob(a, (r, x) => r.fotos.trocarComVizinha(x, fa.id, 'cima', 1))).toBe('na_ponta');
    expect(await sob(a, (r, x) => r.fotos.trocarComVizinha(x, fb.id, 'baixo', 3))).toBe('na_ponta');
    expect(await sob(a, (r, x) => r.fotos.trocarComVizinha(x, fc.id, 'cima', 3))).toBe('ordem_mudou');
    expect(await fotografiaFotos(c, a.salaoId)).toEqual(antes);
    expect(await sob(a, (r, x) => r.fotos.trocarComVizinha(x, fa.id, 'baixo', 1))).toBe('movida');
    expect((await fotosDe(c, a.salaoId)).map((f) => f.id)).toEqual([fc.id, fa.id, fb.id]);
  });

  it('foto de outro salão, inexistente ou malformada → NaoEncontrado', async () => {
    await limpar(a);
    await limpar(b);
    const fb = await inserirFoto(c, b.salaoId);
    for (const id of [fb.id, UUID_INEXISTENTE, 'x']) {
      await expect(sob(a, (r, x) => r.fotos.trocarComVizinha(x, id, 'cima', 1))).rejects.toBeInstanceOf(NaoEncontrado);
    }
  });
});

describe('RepoFoto.removerCompactando', () => {
  it('apaga, devolve a chave e compacta as posições seguintes', async () => {
    await limpar(a);
    const [f1, f2, f3] = await criarFotos(c, a.salaoId, 3);
    const r = await sob(a, (rs, x) => rs.fotos.removerCompactando(x, f2.id));
    expect(r).toEqual({ chave: f2.chave });
    expect((await fotosDe(c, a.salaoId)).map((f) => [f.id, f.posicao])).toEqual([[f1.id, 1], [f3.id, 2]]);
  });

  it('de outro salão, inexistente ou malformada → NaoEncontrado, sem escrita em nenhum salão', async () => {
    await limpar(a);
    await limpar(b);
    await criarFotos(c, a.salaoId, 2);
    const fb = await inserirFoto(c, b.salaoId);
    const antesA = await fotografiaFotos(c, a.salaoId);
    const antesB = await fotografiaFotos(c, b.salaoId);
    for (const id of [fb.id, UUID_INEXISTENTE, 'x']) {
      await expect(sob(a, (r, x) => r.fotos.removerCompactando(x, id))).rejects.toBeInstanceOf(NaoEncontrado);
    }
    expect(await fotografiaFotos(c, a.salaoId)).toEqual(antesA);
    expect(await fotografiaFotos(c, b.salaoId)).toEqual(antesB);
  });
});

describe('contexto inválido', () => {
  it('contexto admin ou público → erro de programação antes de qualquer consulta', async () => {
    const invalidos = [criarAdminContext(a.gestor.usuarioId), criarPublicoContext(a.salaoId, a.slugAtual)] as unknown as ContextoEscopado[];
    for (const ctx of invalidos) {
      const f = repos().fotos;
      for (const chamada of [
        f.listar(ctx),
        f.prechecar(ctx, randomUUID()),
        f.inserirNoFim(ctx, novo()),
        f.editarAlt(ctx, randomUUID(), 'x'),
        f.trocarComVizinha(ctx, randomUUID(), 'cima', 1),
        f.removerCompactando(ctx, randomUUID()),
      ]) {
        await expect(chamada).rejects.toThrow();
        await expect(chamada).rejects.not.toBeInstanceOf(NaoEncontrado);
      }
    }
  });
});

describe('leitura pública e busca por id (RN-14, RN-15)', () => {
  it('lerFotosPublicasDoSalao: só as do salão, por posição, com as colunas exatas; vazio → []', async () => {
    await limpar(a);
    await limpar(b);
    const [f1, f2, f3] = await criarFotos(c, a.salaoId, 3);
    await inserirFoto(c, b.salaoId);
    const r = await lerFotosPublicasDoSalao(criarPublicoContext(a.salaoId, a.slugAtual));
    expect(r.map((l) => l.id)).toEqual([f1.id, f2.id, f3.id]);
    expect(Object.keys(r[0]).sort()).toEqual(['alt', 'altura', 'chave', 'id', 'largura']);
    await limpar(b);
    expect(await lerFotosPublicasDoSalao(criarPublicoContext(b.salaoId, b.slugAtual))).toEqual([]);
  });

  it('não filtra suspensão', async () => {
    await limpar(a);
    await criarFotos(c, a.salaoId, 1);
    await c.query('UPDATE salao SET suspenso_manual_em = now() WHERE id = $1', [a.salaoId]);
    try {
      expect(await lerFotosPublicasDoSalao(criarPublicoContext(a.salaoId, a.slugAtual))).toHaveLength(1);
    } finally {
      await c.query('UPDATE salao SET suspenso_manual_em = NULL WHERE id = $1', [a.salaoId]);
    }
  });

  it('buscarChaveDaFoto: chave por id; inexistente, malformado e chave no lugar do id → null', async () => {
    await limpar(a);
    const [f] = await criarFotos(c, a.salaoId, 1);
    expect(await buscarChaveDaFoto(f.id)).toBe(f.chave);
    expect(await buscarChaveDaFoto(UUID_INEXISTENTE)).toBeNull();
    for (const ruim of ['abc', '../../etc/passwd', f.chave, '']) expect(await buscarChaveDaFoto(ruim)).toBeNull();
  });
});

describe('constraints de banco usadas pelo repositório', () => {
  it('a 13ª posição e posições repetidas no commit são recusadas pelo banco (rede de segurança)', async () => {
    await limpar(a);
    await criarFotos(c, a.salaoId, 2);
    const e1 = await erroSql(inserirFoto(c, a.salaoId, { posicao: 13 }));
    expect(e1.code).toBe('23514');
    const e2 = await erroSql(inserirFoto(c, a.salaoId, { posicao: 2 }));
    expect(e2.code).toBe('23505');
  });
});
