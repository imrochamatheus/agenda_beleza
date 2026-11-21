import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { moverFoto } from '@/server/fotos/fotos.acao';
import { MENSAGENS_FOTO } from '@/server/fotos/tipos';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { credGestor, criarFotos, fotografiaFotos, fotosDe, posicoesDe } from './apoio';

// D-021 T-7: CA-8 (parte serial). A concorrência ×10 está em concorrencia.test.ts (T-8).

let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});
afterEach(async () => {
  await c.query('DELETE FROM salao_foto WHERE salao_id = $1', [s.salaoId]);
  vi.restoreAllMocks();
});

describe('reordenação (CA-8)', () => {
  it('move C para cima (esperada 3): A, C, B; mover A para cima e repetir C com esperada 3 são recusados sem escrita', async () => {
    const cred = await credGestor(s);
    const [a, b, cc] = await criarFotos(c, s.salaoId, 3);
    expect(await moverFoto.executar(cred, { fotoId: cc.id, direcao: 'cima', posicaoEsperada: 3 })).toEqual({ ok: true, dados: { resultado: 'movida' } });
    expect((await fotosDe(c, s.salaoId)).map((f) => f.id)).toEqual([a.id, cc.id, b.id]);
    const antes = await fotografiaFotos(c, s.salaoId);
    expect(await moverFoto.executar(cred, { fotoId: a.id, direcao: 'cima', posicaoEsperada: 1 })).toEqual({ ok: true, dados: { resultado: 'na_ponta' } });
    expect(await moverFoto.executar(cred, { fotoId: cc.id, direcao: 'cima', posicaoEsperada: 3 })).toEqual({ ok: true, dados: { resultado: 'ordem_mudou' } });
    expect(await fotografiaFotos(c, s.salaoId)).toEqual(antes);
    expect(MENSAGENS_FOTO.ordem_mudou).toBe('A ordem das fotos mudou. Confira e tente de novo.');
  });

  it('entrada fora do contrato (direção, posição) não escreve', async () => {
    const cred = await credGestor(s);
    const [a] = await criarFotos(c, s.salaoId, 2);
    const antes = await fotografiaFotos(c, s.salaoId);
    for (const e of [
      { fotoId: a.id, direcao: 'lado', posicaoEsperada: 1 },
      { fotoId: a.id, direcao: 'baixo', posicaoEsperada: 0 },
      { fotoId: a.id, direcao: 'baixo', posicaoEsperada: 'x' },
    ]) {
      const r = await moverFoto.executar(cred, e as never);
      expect(r).toEqual({ ok: true, dados: { resultado: 'ordem_mudou' } });
    }
    expect(await fotografiaFotos(c, s.salaoId)).toEqual(antes);
    expect(await posicoesDe(c, s.salaoId)).toEqual([1, 2]);
  });
});
