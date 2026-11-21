import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { servirFoto } from '@/server/fotos/entrega';
import { removerFoto } from '@/server/fotos/fotos.acao';
import { integracoes } from '@/server/integrations/registry';
import { ErroDeArmazenamento } from '@/server/integrations/armazenamento/port';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { jpegPequeno } from '../../support/imagens';
import { conectar } from '../../support/sql';

import { credGestor, fotosDe, posicoesDe } from './apoio';
import { APP_URL, capturarLogs, codigoDoRedirect, encerrarArmazenamento, enviarPorHttp, prepararArmazenamento } from './apoio-servico';
import type { Armazenamento } from './apoio-servico';
import { randomUUID } from 'node:crypto';

// D-021 T-7: CA-6 (remoção compacta; objeto removido só depois do commit; falha não desfaz).

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
  arm.limpar();
  vi.restoreAllMocks();
});

async function tresFotos() {
  const cred = await credGestor(s);
  for (const alt of ['A', 'B', 'C']) await enviarPorHttp(cred, { arquivo: await jpegPequeno(), alt, envio: randomUUID() });
  return { cred, fotos: await fotosDe(c, s.salaoId) };
}

describe('remoção (CA-6)', () => {
  it('remove a da posição 2: a linha some, as outras compactam, o objeto sai DEPOIS do commit e a rota pública dá 404', async () => {
    const { cred, fotos } = await tresFotos();
    const [f1, f2, f3] = fotos;
    const porta = integracoes().armazenamento;
    const original = porta.remover.bind(porta);
    let linhaVisivelNaChamada: boolean | null = null;
    const outra = await conectar();
    vi.spyOn(porta, 'remover').mockImplementation(async (chave) => {
      const { rows } = await outra.query('SELECT 1 FROM salao_foto WHERE id = $1', [f2.id]);
      linhaVisivelNaChamada = rows.length > 0;
      return original(chave);
    });
    expect(await removerFoto.executar(cred, { fotoId: f2.id })).toEqual({ ok: true, dados: { resultado: 'removida' } });
    await outra.end();
    expect(linhaVisivelNaChamada).toBe(false);
    expect((await fotosDe(c, s.salaoId)).map((f) => [f.id, f.posicao])).toEqual([[f1.id, 1], [f3.id, 2]]);
    expect(arm.objetos()).toHaveLength(2);
    expect(arm.objetos()).not.toContain(f2.chave.replace('fotos/', ''));
    const r = await servirFoto(f2.id, new Request(`${APP_URL}/api/fotos/${f2.id}`));
    expect(r.status).toBe(404);
  });

  it('adaptador cuja remover lança: sucesso, linha removida, posições compactas, log orfao só com a chave', async () => {
    const { cred, fotos } = await tresFotos();
    const logs = capturarLogs();
    vi.spyOn(integracoes().armazenamento, 'remover').mockRejectedValue(new ErroDeArmazenamento('falha com dados@x.com'));
    expect(await removerFoto.executar(cred, { fotoId: fotos[0].id })).toEqual({ ok: true, dados: { resultado: 'removida' } });
    expect(await posicoesDe(c, s.salaoId)).toEqual([1, 2]);
    const texto = logs();
    expect(texto).toContain('armazenamento.orfao');
    expect(texto).toContain(fotos[0].chave);
    expect(texto).not.toContain('dados@x.com');
    expect(texto).not.toContain(s.gestor.email);
    const r = await servirFoto(fotos[0].id, new Request(`${APP_URL}/api/fotos/${fotos[0].id}`));
    expect(r.status).toBe(404);
  });

  it('codigoDoRedirect de um envio ok continua funcionando (sanidade do apoio)', async () => {
    const cred = await credGestor(s);
    expect(codigoDoRedirect(await enviarPorHttp(cred, { arquivo: await jpegPequeno() }))).toBe('ok');
  });
});
