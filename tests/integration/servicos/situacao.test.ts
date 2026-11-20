import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { listarServicosPublicos } from '@/server/repos/publico';
import { desativarServico, reativarServico } from '@/server/servicos/servicos.acao';

import { credencialDoGestor } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { contarServicos, ctxPublico, fotografiaReservas, inserirServico, linhaServico, vinculosDe } from './apoio';

// D-014 T-3: CA-3 (RN-2, RN-7, RN-9). Desativar é soft delete: a linha fica, sai da leitura pública,
// reservas e vínculos ficam iguais; reativar a devolve.

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CA-3: desativar e reativar', () => {
  it('CA-3: desativar mantém a linha (ativo = false), tira da leitura pública e não muda reservas nem vínculos; reativar devolve', async () => {
    const s = await criarSalaoCompleto();
    const g = await credencialDoGestor(s);
    const id = s.servicos.ativos[0];
    const contagem = await contarServicos(c, s.salaoId);
    const reservas = await fotografiaReservas(c, s.salaoId);
    const vinculos = await vinculosDe(c, id);
    expect(vinculos.length).toBeGreaterThan(0);
    expect((await listarServicosPublicos(ctxPublico(s))).map((x) => x.id)).toContain(id);

    expect(await desativarServico.executar(g, { id })).toEqual({ ok: true, dados: { resultado: 'desativado', ofertavel: false } });
    expect(await contarServicos(c, s.salaoId)).toBe(contagem);
    expect((await linhaServico(c, id))!.ativo).toBe(false);
    expect((await listarServicosPublicos(ctxPublico(s))).map((x) => x.id)).not.toContain(id);
    expect(await fotografiaReservas(c, s.salaoId)).toEqual(reservas);
    expect(await vinculosDe(c, id)).toEqual(vinculos);

    // Idempotente: desativar de novo não é erro.
    expect(await desativarServico.executar(g, { id })).toEqual({ ok: true, dados: { resultado: 'desativado', ofertavel: false } });

    expect(await reativarServico.executar(g, { id })).toEqual({ ok: true, dados: { resultado: 'reativado', ofertavel: true } });
    expect((await linhaServico(c, id))!.ativo).toBe(true);
    expect((await listarServicosPublicos(ctxPublico(s))).map((x) => x.id)).toContain(id);
    expect(await fotografiaReservas(c, s.salaoId)).toEqual(reservas);
    expect(await vinculosDe(c, id)).toEqual(vinculos);
  });

  it('reativar serviço sem profissional ativo → reativado, mas não ofertável', async () => {
    const s = await criarSalaoCompleto();
    const g = await credencialDoGestor(s);
    const id = await inserirServico(c, s.salaoId, { nome: 'Sem ninguém', ativo: false });
    expect(await reativarServico.executar(g, { id })).toEqual({ ok: true, dados: { resultado: 'reativado', ofertavel: false } });
    expect((await linhaServico(c, id))!.ativo).toBe(true);
  });
});
