import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { lerFotosPublicas } from '@/server/fotos/leitura';
import { editarAltDaFoto } from '@/server/fotos/fotos.acao';
import { criarPublicoContext } from '@/server/tenant/context';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { credGestor, criarFotos, fotografiaFotos, fotosDe } from './apoio';
import { encerrarArmazenamento, prepararArmazenamento } from './apoio-servico';
import type { Armazenamento } from './apoio-servico';

// D-021 T-7: CA-7 (texto alternativo).

let c: pg.Client;
let s: SalaoCompleto;
let arm: Armazenamento;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
  arm = prepararArmazenamento();
});
afterAll(async () => {
  encerrarArmazenamento(arm);
  await c.end();
});
afterEach(async () => {
  await c.query('DELETE FROM salao_foto WHERE salao_id = $1', [s.salaoId]);
});

describe('texto alternativo (CA-7)', () => {
  it('muda só o alt, normaliza, e a leitura pública devolve o novo texto', async () => {
    const cred = await credGestor(s);
    const [f] = await criarFotos(c, s.salaoId, 1);
    const r = await editarAltDaFoto.executar(cred, { fotoId: f.id, alt: '  Fachada   do  salão ' });
    expect(r).toEqual({ ok: true, dados: { resultado: 'salvo' } });
    const [depois] = await fotosDe(c, s.salaoId);
    expect(depois.alt).toBe('Fachada do salão');
    expect({ ...depois, alt: f.alt }).toEqual(f);
    const [publica] = await lerFotosPublicas(criarPublicoContext(s.salaoId, s.slugAtual));
    expect(publica.alt).toBe('Fachada do salão');
  });

  it('o mesmo texto não altera a linha (xmin igual)', async () => {
    const cred = await credGestor(s);
    const [f] = await criarFotos(c, s.salaoId, 1);
    const antes = await fotografiaFotos(c, s.salaoId);
    await editarAltDaFoto.executar(cred, { fotoId: f.id, alt: f.alt });
    expect(await fotografiaFotos(c, s.salaoId)).toEqual(antes);
  });

  it.each([[''], ['   '], ['a'.repeat(151)], ['a\nb'], ['a\tb']])('%j é recusado sem escrita', async (alt) => {
    const cred = await credGestor(s);
    const [f] = await criarFotos(c, s.salaoId, 1);
    const antes = await fotografiaFotos(c, s.salaoId);
    const r = await editarAltDaFoto.executar(cred, { fotoId: f.id, alt });
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'invalido' } });
    expect((r as { dados: { erro: string } }).dados.erro.length).toBeGreaterThan(10);
    expect(await fotografiaFotos(c, s.salaoId)).toEqual(antes);
  });
});
