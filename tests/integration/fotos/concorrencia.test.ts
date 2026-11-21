import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { moverFoto, removerFoto } from '@/server/fotos/fotos.acao';

import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { jpegPequeno } from '../../support/imagens';
import { conectar } from '../../support/sql';

import { credGestor, criarFotos, fotosDe, posicoesDe } from './apoio';
import { codigoDoRedirect, encerrarArmazenamento, enviarPorHttp, prepararArmazenamento } from './apoio-servico';
import type { Armazenamento } from './apoio-servico';

// D-021 T-8: CA-3 (limite de 12), CA-8 (reordenação concorrente) e CA-13 (duplo envio em paralelo).
// Rodar em laço ×10 (CLAUDE.md): cada execução recria o banco do worker.

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;
let arm: Armazenamento;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
  arm = prepararArmazenamento();
});
afterAll(async () => {
  encerrarArmazenamento(arm);
  await c.end();
});
afterEach(async () => {
  await c.query('DELETE FROM salao_foto WHERE salao_id IN ($1, $2)', [a.salaoId, b.salaoId]);
  arm.limpar();
});

const contiguas = async (s: SalaoCompleto) => {
  const p = await posicoesDe(c, s.salaoId);
  expect(p).toEqual(p.map((_, i) => i + 1));
  return p.length;
};
const objetosDeFotos = async (...ss: SalaoCompleto[]) => (await Promise.all(ss.map((s) => fotosDe(c, s.salaoId)))).flat().map((f) => f.chave.replace('fotos/', '')).sort();

describe('limite de 12 (CA-3)', () => {
  it('dois envios diferentes em paralelo com 11 fotos: um aceito, um limite; 12 linhas e 12 objetos', async () => {
    for (let rodada = 0; rodada < 3; rodada++) {
      await c.query('DELETE FROM salao_foto WHERE salao_id = $1', [a.salaoId]);
      arm.limpar();
      await criarFotos(c, a.salaoId, 11);
      // objetos das 11 linhas plantadas: o armazenamento só conta o que o serviço gravou
      const cred = await credGestor(a);
      const arquivo = await jpegPequeno();
      const rs = await Promise.all([
        enviarPorHttp(cred, { arquivo, envio: randomUUID(), alt: 'um' }),
        enviarPorHttp(cred, { arquivo, envio: randomUUID(), alt: 'dois' }),
      ]);
      expect(rs.every((r) => r.status === 303)).toBe(true);
      expect(rs.map(codigoDoRedirect).sort()).toEqual(['limite', 'ok']);
      expect(await contiguas(a)).toBe(12);
      expect(arm.objetos()).toHaveLength(1); // só o do vencedor: o do perdedor foi compensado
    }
  });

  it('11 fotos em S1 e 11 em S2: envios simultâneos em ambos são aceitos (trava por salão)', async () => {
    await criarFotos(c, a.salaoId, 11);
    await criarFotos(c, b.salaoId, 11);
    const arquivo = await jpegPequeno();
    const rs = await Promise.all([
      enviarPorHttp(await credGestor(a), { arquivo, envio: randomUUID() }),
      enviarPorHttp(await credGestor(b), { arquivo, envio: randomUUID() }),
    ]);
    expect(rs.map(codigoDoRedirect)).toEqual(['ok', 'ok']);
    expect(await contiguas(a)).toBe(12);
    expect(await contiguas(b)).toBe(12);
  });

  it('muitos envios em paralelo nunca passam de 12 nem deixam objeto sobrando', async () => {
    const cred = await credGestor(a);
    const arquivo = await jpegPequeno();
    const rs = await Promise.all(Array.from({ length: 16 }, () => enviarPorHttp(cred, { arquivo, envio: randomUUID() })));
    const codigos = rs.map(codigoDoRedirect);
    expect(codigos.filter((x) => x === 'ok')).toHaveLength(12);
    expect(codigos.filter((x) => x === 'limite')).toHaveLength(4);
    expect(await contiguas(a)).toBe(12);
    expect(arm.objetos().sort()).toEqual(await objetosDeFotos(a));
  }, 60_000);
});

describe('duplo envio (CA-13)', () => {
  it('o mesmo token em paralelo: uma linha, as duas respostas ok, um objeto', async () => {
    const cred = await credGestor(a);
    const arquivo = await jpegPequeno();
    const envio = randomUUID();
    const rs = await Promise.all([enviarPorHttp(cred, { arquivo, envio }), enviarPorHttp(cred, { arquivo, envio })]);
    expect(rs.map(codigoDoRedirect)).toEqual(['ok', 'ok']);
    expect(await fotosDe(c, a.salaoId)).toHaveLength(1);
    expect(arm.objetos()).toHaveLength(1);
  });
});

describe('reordenação concorrente (CA-8)', () => {
  it('duas reordenações da mesma foto com a mesma posição esperada: exatamente uma aplicada', async () => {
    const cred = await credGestor(a);
    const fotos = await criarFotos(c, a.salaoId, 4);
    const e = { fotoId: fotos[2].id, direcao: 'cima' as const, posicaoEsperada: 3 };
    const rs = await Promise.all([moverFoto.executar(cred, e), moverFoto.executar(cred, e)]);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(rs.map((r) => (r.ok ? r.dados.resultado : 'x')).sort()).toEqual(['movida', 'ordem_mudou']);
    expect(await contiguas(a)).toBe(4);
    expect((await fotosDe(c, a.salaoId)).map((f) => f.id)).toEqual([fotos[0].id, fotos[2].id, fotos[1].id, fotos[3].id]);
  });

  it('reordenação × remoção × envio no mesmo salão: posições 1..n contíguas, sem 5xx nem impasse', async () => {
    const cred = await credGestor(a);
    const fotos = await criarFotos(c, a.salaoId, 6);
    const arquivo = await jpegPequeno();
    const rs = await Promise.all([
      moverFoto.executar(cred, { fotoId: fotos[4].id, direcao: 'cima', posicaoEsperada: 5 }),
      moverFoto.executar(cred, { fotoId: fotos[1].id, direcao: 'baixo', posicaoEsperada: 2 }),
      removerFoto.executar(cred, { fotoId: fotos[2].id }),
      removerFoto.executar(cred, { fotoId: fotos[5].id }),
      enviarPorHttp(cred, { arquivo, envio: randomUUID() }),
      enviarPorHttp(cred, { arquivo, envio: randomUUID() }),
    ]);
    for (const r of rs.slice(0, 4)) expect((r as { ok: boolean }).ok).toBe(true);
    for (const r of rs.slice(4)) expect(codigoDoRedirect(r as Response)).toBe('ok');
    expect(await contiguas(a)).toBe(6);
  }, 60_000);
});
