import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as acoes from '@/server/bloqueios/bloqueios.acao';
import { lerBloqueios } from '@/server/bloqueios/leitura';
import { listar, obterParaEdicao, opcoesDeAlvo } from '@/server/bloqueios/servico';
import { contextoDeSistema } from '@/server/tenant/context';
import { metadadosDaAcao } from '@/server/tenant/define-acao';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';
import type { Credencial } from '@/server/tenant/sessao';

import { criarSessao, criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import {
  ACESSO_NEGADO,
  AGORA,
  NAO_AUTENTICADO,
  NAO_ENCONTRADO,
  UUID_INEXISTENTE,
  comHorario,
  credGestor,
  credProfissional,
  criarReservaEm,
  ctxDoGestor,
  ctxDoProfissional,
  definirAtivo,
  diaInteiro,
  inserirBloqueio,
  linhasBloqueio,
} from './apoio';

// D-016 T-5: isolamento entre salões (G-4) e permissões por papel. CA-2, CA-13, CA-14, CA-19, mais
// super admin, sessão ausente, profissional inativo e lerBloqueios (E3.1).

const exec = { agora: AGORA };

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;
let gestorA: Credencial;
let profA: Credencial;
/** Bloqueios em A: do salão, da Ana (profissional) e do gestor (colega da Ana). */
const ids = { salao: '', ana: '', colega: '' };
/** Bloqueio de B. */
let deB = '';

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
  gestorA = await credGestor(a);
  profA = await credProfissional(a);
  ids.salao = await inserirBloqueio(c, { salaoId: a.salaoId, profissionalId: null, inicio: '2026-12-25T03:00Z', fim: '2026-12-26T03:00Z', motivo: 'Natal' });
  ids.ana = await inserirBloqueio(c, { salaoId: a.salaoId, profissionalId: a.profissional.profissionalId, inicio: '2026-12-10T17:00Z', fim: '2026-12-10T19:00Z' });
  ids.colega = await inserirBloqueio(c, { salaoId: a.salaoId, profissionalId: a.gestor.profissionalId, inicio: '2026-12-11T17:00Z', fim: '2026-12-11T19:00Z' });
  deB = await inserirBloqueio(c, { salaoId: b.salaoId, profissionalId: b.profissional.profissionalId, inicio: '2026-12-10T17:00Z', fim: '2026-12-10T19:00Z' });
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

const UM_DIA = comHorario('15/12/2026', '10:00', '15/12/2026', '11:00');

describe('CA-2: o profissional só gere os próprios', () => {
  it('criar com alvo de colega, salão, outro salão, inexistente ou malformado → 403 sem efeito', async () => {
    const antesA = await linhasBloqueio(c, a.salaoId);
    const antesB = await linhasBloqueio(c, b.salaoId);
    for (const alvo of [a.gestor.profissionalId, a.profissionalInativoId, 'salao', b.profissional.profissionalId, UUID_INEXISTENTE, 'abc']) {
      expect(await acoes.criarBloqueio.executar(profA, { ...UM_DIA, alvo }, exec), String(alvo)).toEqual(ACESSO_NEGADO);
    }
    expect(await linhasBloqueio(c, a.salaoId)).toEqual(antesA);
    expect(await linhasBloqueio(c, b.salaoId)).toEqual(antesB);
  });

  it('editar ou remover bloqueio do colega ou do salão → 403 sem efeito', async () => {
    const antes = await linhasBloqueio(c, a.salaoId);
    for (const id of [ids.colega, ids.salao]) {
      expect(await acoes.editarBloqueio.executar(profA, { id, ...UM_DIA }, exec)).toEqual(ACESSO_NEGADO);
      expect(await acoes.removerBloqueio.executar(profA, { id }, exec)).toEqual(ACESSO_NEGADO);
    }
    expect(await linhasBloqueio(c, a.salaoId)).toEqual(antes);
  });

  it('editar ou remover bloqueio de B, inexistente ou malformado → 404', async () => {
    for (const id of [deB, UUID_INEXISTENTE, 'abc']) {
      expect(await acoes.editarBloqueio.executar(profA, { id, ...UM_DIA }, exec)).toEqual(NAO_ENCONTRADO);
      expect(await acoes.removerBloqueio.executar(profA, { id }, exec)).toEqual(NAO_ENCONTRADO);
    }
  });

  it('edita e remove o próprio', async () => {
    const proprio = await inserirBloqueio(c, { salaoId: a.salaoId, profissionalId: a.profissional.profissionalId, inicio: '2026-12-12T17:00Z', fim: '2026-12-12T18:00Z' });
    expect(await acoes.editarBloqueio.executar(profA, { id: proprio, ...UM_DIA }, exec)).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
    expect(await acoes.removerBloqueio.executar(profA, { id: proprio }, exec)).toMatchObject({ ok: true });
  });

  it('super admin → 403 nas três ações; sem credencial → 401; nada gravado', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    const antes = await linhasBloqueio(c, a.salaoId);
    expect(await acoes.criarBloqueio.executar(admin.credencial, { ...UM_DIA, alvo: 'salao' })).toEqual(ACESSO_NEGADO);
    expect(await acoes.editarBloqueio.executar(admin.credencial, { id: ids.salao, ...UM_DIA })).toEqual(ACESSO_NEGADO);
    expect(await acoes.removerBloqueio.executar(admin.credencial, { id: ids.salao })).toEqual(ACESSO_NEGADO);
    expect(await acoes.criarBloqueio.executar(null, { ...UM_DIA, alvo: 'salao' }, exec)).toEqual(NAO_AUTENTICADO);
    expect(await acoes.editarBloqueio.executar(null, { id: ids.salao, ...UM_DIA }, exec)).toEqual(NAO_AUTENTICADO);
    expect(await acoes.removerBloqueio.executar(null, { id: ids.salao }, exec)).toEqual(NAO_AUTENTICADO);
    expect(await linhasBloqueio(c, a.salaoId)).toEqual(antes);
  });

  it('profissional com perfil inativo → 401', async () => {
    const t = await criarDoisSaloes();
    const cred = (await criarSessao(t.a.profissional.usuarioId, { expiraEm: new Date('2099-01-01T00:00:00Z') })).credencial;
    await definirAtivo(c, t.a.profissional.profissionalId, false);
    expect(await acoes.criarBloqueio.executar(cred, UM_DIA, exec)).toEqual(NAO_AUTENTICADO);
  });
});

describe('CA-13: isolamento entre salões', () => {
  it('gestor de A: criar para profissional de B, inexistente ou malformado → 404; editar/remover bloqueio de B → 404; B intacto', async () => {
    const antesB = await linhasBloqueio(c, b.salaoId);
    const antesA = await linhasBloqueio(c, a.salaoId);
    for (const alvo of [b.profissional.profissionalId, b.gestor.profissionalId, UUID_INEXISTENTE, 'abc']) {
      expect(await acoes.criarBloqueio.executar(gestorA, { ...UM_DIA, alvo }, exec), String(alvo)).toEqual(NAO_ENCONTRADO);
    }
    for (const id of [deB, b.bloqueioId, UUID_INEXISTENTE, 'abc']) {
      expect(await acoes.editarBloqueio.executar(gestorA, { id, ...UM_DIA }, exec)).toEqual(NAO_ENCONTRADO);
      expect(await acoes.removerBloqueio.executar(gestorA, { id }, exec)).toEqual(NAO_ENCONTRADO);
    }
    expect(await linhasBloqueio(c, b.salaoId)).toEqual(antesB);
    expect(await linhasBloqueio(c, a.salaoId)).toEqual(antesA);
  });

  it('salaoId/profissionalId extras no corpo de criação → recusados (formulario), nada gravado', async () => {
    const antesB = await linhasBloqueio(c, b.salaoId);
    expect(await acoes.criarBloqueio.executar(gestorA, comHorario('15/12/2026', '10:00', '15/12/2026', '11:00', { alvo: 'salao', salaoId: b.salaoId }), exec)).toMatchObject({
      ok: true,
      dados: { resultado: 'invalido', erros: { formulario: expect.any(String) } },
    });
    expect(await acoes.criarBloqueio.executar(profA, comHorario('15/12/2026', '10:00', '15/12/2026', '11:00', { profissionalId: b.profissional.profissionalId }), exec)).toMatchObject({
      ok: true,
      dados: { resultado: 'invalido' },
    });
    expect(await linhasBloqueio(c, b.salaoId)).toEqual(antesB);
  });

  it('a lista de A nunca contém bloqueios de B', async () => {
    const { itens } = await listar(ctxDoGestor(a), new Date('2026-01-01T00:00:00Z'));
    const idsDeB = (await linhasBloqueio(c, b.salaoId)).map((l) => l.id);
    expect(itens.length).toBeGreaterThan(0);
    for (const i of itens) expect(idsDeB).not.toContain(i.id);
  });

  it('o aviso de bloqueio do salão em A nunca lista reservas de B no mesmo horário', async () => {
    const t = await criarDoisSaloes();
    const deA = await criarReservaEm(c, { salaoId: t.a.salaoId, profissionalId: t.a.profissional.profissionalId, clienteId: t.a.clientes.ativaId, inicio: '2026-12-29T18:00Z', fim: '2026-12-29T19:00Z' });
    await criarReservaEm(c, { salaoId: t.b.salaoId, profissionalId: t.b.profissional.profissionalId, clienteId: t.b.clientes.ativaId, inicio: '2026-12-29T18:00Z', fim: '2026-12-29T19:00Z' });
    const r = await acoes.criarBloqueio.executar(await credGestor(t.a), diaInteiro('29/12/2026', '29/12/2026', { alvo: 'salao' }), exec);
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo', aviso: { total: 1, reservas: [{ id: deA }] } } });
  });
});

describe('CA-14: o que cada papel vê', () => {
  it('profissional: os próprios (editáveis) e os do salão (somente leitura); nunca os do colega', async () => {
    const { itens } = await listar(ctxDoProfissional(a), AGORA);
    const porId = new Map(itens.map((i) => [i.id, i]));
    expect(porId.get(ids.ana)?.editavel).toBe(true);
    expect(porId.get(ids.salao)).toMatchObject({ editavel: false, alvo: { tipo: 'salao' } });
    expect(porId.has(ids.colega)).toBe(false);
    expect(itens.every((i) => i.alvo.tipo === 'salao' || (i.alvo.tipo === 'profissional' && i.alvo.id === a.profissional.profissionalId))).toBe(true);
  });

  it('gestor: os do salão e de todos os profissionais, identificados', async () => {
    const { itens } = await listar(ctxDoGestor(a), AGORA);
    const porId = new Map(itens.map((i) => [i.id, i]));
    expect(porId.get(ids.salao)?.alvo).toEqual({ tipo: 'salao' });
    expect(porId.get(ids.ana)?.alvo).toMatchObject({ tipo: 'profissional', nome: a.profissional.nome });
    expect(porId.get(ids.colega)?.alvo).toMatchObject({ tipo: 'profissional', nome: a.gestor.nome });
    expect(itens.every((i) => i.editavel)).toBe(true);
  });

  it('opcoesDeAlvo: gestor → salão + profissionais do salão; profissional → null', async () => {
    const opcoes = await opcoesDeAlvo(ctxDoGestor(a));
    expect(opcoes?.[0]).toEqual({ valor: 'salao', rotulo: 'Salão inteiro' });
    expect(opcoes?.map((o) => o.valor).sort()).toEqual(['salao', a.gestor.profissionalId!, a.profissional.profissionalId, a.profissionalInativoId].sort());
    expect(opcoes?.find((o) => o.valor === a.profissionalInativoId)?.rotulo).toMatch(/\(inativo\)$/);
    expect(await opcoesDeAlvo(ctxDoProfissional(a))).toBeNull();
  });

  it('obterParaEdicao: o próprio → valores; do salão ou do colega (profissional) → 403; de B/inexistente/malformado/não-texto → 404', async () => {
    const r = await obterParaEdicao(ctxDoProfissional(a), ids.ana);
    expect(r.valores).toMatchObject({ modo: 'horario', dataInicio: '10/12/2026', horaInicio: '14:00', horaFim: '16:00' });
    expect((await obterParaEdicao(ctxDoGestor(a), ids.salao)).valores).toMatchObject({ modo: 'dia_inteiro', dataFim: '25/12/2026' });
    for (const id of [ids.salao, ids.colega]) {
      await expect(obterParaEdicao(ctxDoProfissional(a), id)).rejects.toBeInstanceOf(AcessoNegado);
    }
    for (const id of [deB, UUID_INEXISTENTE, 'abc', 7]) {
      await expect(obterParaEdicao(ctxDoGestor(a), id)).rejects.toBeInstanceOf(NaoEncontrado);
    }
  });
});

describe('CA-19: registro das ações', () => {
  it('as três ações declaram papeis [gestor, profissional] e capacidade configurar', () => {
    expect(Object.keys(acoes).sort()).toEqual(['criarBloqueio', 'editarBloqueio', 'removerBloqueio']);
    for (const acao of [acoes.criarBloqueio, acoes.editarBloqueio, acoes.removerBloqueio]) {
      expect(metadadosDaAcao(acao)).toEqual({ papeis: ['gestor', 'profissional'], capacidade: 'configurar' });
    }
  });
});

describe('lerBloqueios (E3.1/E3.3), sem checagem de papel', () => {
  it('SistemaContext: por período, com e sem profissional; só do salão do contexto', async () => {
    const ctx = contextoDeSistema(a.salaoId, 'teste');
    const dezembro = { de: new Date('2026-12-01T00:00:00Z'), ate: new Date('2027-01-01T00:00:00Z') };
    const todos = await lerBloqueios(ctx, dezembro);
    expect(todos.map((x) => x.id)).toEqual(expect.arrayContaining([ids.salao, ids.ana, ids.colega]));
    expect(todos.map((x) => x.id)).not.toContain(deB);
    expect(Object.keys(todos[0]).sort()).toEqual(['fim', 'id', 'inicio', 'motivo', 'profissionalId']);
    const daAna = await lerBloqueios(ctx, dezembro, { profissionalId: a.profissional.profissionalId });
    expect(daAna.map((x) => x.id)).toEqual(expect.arrayContaining([ids.salao, ids.ana]));
    expect(daAna.map((x) => x.id)).not.toContain(ids.colega);
    expect(daAna.find((x) => x.id === ids.salao)).toMatchObject({ profissionalId: null, motivo: 'Natal' });
  });
});
