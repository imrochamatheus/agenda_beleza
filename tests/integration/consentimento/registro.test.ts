import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { VERSAO_TERMOS } from '@/config/termos';
import { lerConsentimentoDoFormulario } from '@/server/consentimento/formulario';
import { temConsentimentoDeMensagens } from '@/server/consentimento/leitura';
import { registrarConsentimento, registrarConsentimentoDaReserva } from '@/server/consentimento/servico';
import { CAMPOS_CONSENTIMENTO, MENSAGENS_CONSENTIMENTO } from '@/server/consentimento/tipos';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { AGORA, contarDoSalao, ctxDoGestor, ctxDoProfissional, ctxPublico, inserirCliente, linhasDe } from './apoio';

// D-023 T-5: CA-1, CA-2, CA-5 (linhas), CA-7, CA-8, CA-9 (integrado) com PostgreSQL real.

let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
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

const novaCliente = () => inserirCliente(c, s.salaoId, 'Cliente Consentida');

describe('CA-1: sem o aceite obrigatório nada é gravado', () => {
  it.each([
    undefined,
    null,
    'on',
    {},
    { mensagensReserva: false },
    { mensagensReserva: 'false' },
    { mensagensReserva: '' },
    { mensagensReserva: 0 },
    { mensagensReserva: 1 },
    { mensagensReserva: 'yes' },
    { mensagensReserva: [true] },
    { mensagensReserva: {} },
    { conviteAvaliacao: true },
  ])('%j → ok:false e a contagem não muda', async (aceites) => {
    const clienteId = await novaCliente();
    const antes = await contarDoSalao(c, s.salaoId);
    await expect(registrarConsentimentoDaReserva(ctxPublico(s), { clienteId, aceites, origem: 'publico', agora: AGORA })).resolves.toEqual({
      ok: false,
      erros: { mensagensReserva: MENSAGENS_CONSENTIMENTO.mensagensReserva },
    });
    expect(await contarDoSalao(c, s.salaoId)).toBe(antes);
  });
});

describe('CA-2: aceite público das mensagens da reserva', () => {
  it('grava exatamente 1 linha com versão, instante UTC, salão e cliente corretos', async () => {
    const clienteId = await novaCliente();
    const r = await registrarConsentimentoDaReserva(ctxPublico(s), { clienteId, aceites: { mensagensReserva: true }, origem: 'publico', agora: AGORA });
    expect(r).toMatchObject({ ok: true, registrados: [{ finalidade: 'mensagens_reserva' }] });
    const linhas = await linhasDe(c, clienteId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      salao_id: s.salaoId,
      cliente_id: clienteId,
      finalidade: 'mensagens_reserva',
      origem: 'publico',
      versao_termos: VERSAO_TERMOS,
    });
    expect(linhas[0].criado_em.toISOString()).toBe(AGORA.toISOString());
    expect(r.ok && r.registrados[0].id).toBe(linhas[0].id);
  });
});

describe('CA-5: linhas gravadas a partir do FormData', () => {
  const formulario = (campos: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(campos)) fd.set(k, v);
    return fd;
  };
  const gravar = (clienteId: string, campos: Record<string, string>) =>
    registrarConsentimentoDaReserva(ctxPublico(s), { clienteId, aceites: lerConsentimentoDoFormulario(formulario(campos)), origem: 'publico', agora: AGORA });

  it('só a obrigatória → só mensagens_reserva', async () => {
    const clienteId = await novaCliente();
    await gravar(clienteId, { [CAMPOS_CONSENTIMENTO.mensagensReserva]: 'on' });
    expect((await linhasDe(c, clienteId)).map((l) => l.finalidade)).toEqual(['mensagens_reserva']);
  });

  it('as duas → duas linhas com o mesmo instante e a mesma versão', async () => {
    const clienteId = await novaCliente();
    await gravar(clienteId, { [CAMPOS_CONSENTIMENTO.mensagensReserva]: 'on', [CAMPOS_CONSENTIMENTO.conviteAvaliacao]: 'on' });
    const linhas = await linhasDe(c, clienteId);
    expect(linhas.map((l) => l.finalidade).sort()).toEqual(['convite_avaliacao', 'mensagens_reserva']);
    expect(new Set(linhas.map((l) => l.criado_em.toISOString()))).toEqual(new Set([AGORA.toISOString()]));
    expect(new Set(linhas.map((l) => l.versao_termos))).toEqual(new Set([VERSAO_TERMOS]));
  });

  it('só o convite → erro e nenhuma linha', async () => {
    const clienteId = await novaCliente();
    const r = await gravar(clienteId, { [CAMPOS_CONSENTIMENTO.conviteAvaliacao]: 'on' });
    expect(r.ok).toBe(false);
    expect(await linhasDe(c, clienteId)).toEqual([]);
  });
});

describe('CA-7: publicacao_avaliacao pela cliente', () => {
  it('origem publico e contexto de sistema → 1 linha com versão e data UTC', async () => {
    const clienteId = await novaCliente();
    const v = await registrarConsentimento(ctxPublico(s), { clienteId, finalidade: 'publicacao_avaliacao', origem: 'publico', agora: AGORA });
    expect(v).toMatchObject({ finalidade: 'publicacao_avaliacao', origem: 'publico', versaoTermos: VERSAO_TERMOS, criadoEm: AGORA });
    expect(await linhasDe(c, clienteId)).toHaveLength(1);
  });

  it('origem equipe é recusada sem linha', async () => {
    const clienteId = await novaCliente();
    await expect(registrarConsentimento(ctxDoGestor(s), { clienteId, finalidade: 'publicacao_avaliacao', origem: 'equipe', agora: AGORA })).rejects.toBeInstanceOf(RangeError);
    expect(await linhasDe(c, clienteId)).toEqual([]);
  });
});

describe('CA-8: declaração da equipe', () => {
  it.each([
    ['gestor', ctxDoGestor],
    ['profissional', ctxDoProfissional],
  ] as const)('%s registra mensagens_reserva com origem equipe', async (_papel, fabrica) => {
    const clienteId = await novaCliente();
    expect(await temConsentimentoDeMensagens(ctxPublico(s), clienteId)).toBe(false);
    await registrarConsentimento(fabrica(s), { clienteId, finalidade: 'mensagens_reserva', origem: 'equipe', agora: AGORA });
    const linhas = await linhasDe(c, clienteId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ origem: 'equipe', finalidade: 'mensagens_reserva' });
    expect(await temConsentimentoDeMensagens(fabrica(s), clienteId)).toBe(true);
  });

  it.each(['convite_avaliacao', 'publicacao_avaliacao'] as const)('equipe não declara %s: recusa sem linha', async (finalidade) => {
    const clienteId = await novaCliente();
    await expect(registrarConsentimento(ctxDoGestor(s), { clienteId, finalidade, origem: 'equipe', agora: AGORA })).rejects.toBeInstanceOf(RangeError);
    expect(await linhasDe(c, clienteId)).toEqual([]);
  });

  it('pelo contrato da reserva, a equipe ignora o convite: só mensagens_reserva é gravada', async () => {
    const clienteId = await novaCliente();
    const r = await registrarConsentimentoDaReserva(ctxDoGestor(s), { clienteId, aceites: { mensagensReserva: true, conviteAvaliacao: true }, origem: 'equipe', agora: AGORA });
    expect(r.ok && r.registrados.map((x) => x.finalidade)).toEqual(['mensagens_reserva']);
    expect((await linhasDe(c, clienteId)).map((l) => l.finalidade)).toEqual(['mensagens_reserva']);
  });

  it('temConsentimentoDeMensagens vale para origem publico e não confunde finalidades', async () => {
    const clienteId = await novaCliente();
    await registrarConsentimento(ctxPublico(s), { clienteId, finalidade: 'convite_avaliacao', origem: 'publico', agora: AGORA });
    expect(await temConsentimentoDeMensagens(ctxPublico(s), clienteId)).toBe(false);
    await registrarConsentimento(ctxPublico(s), { clienteId, finalidade: 'mensagens_reserva', origem: 'publico', agora: AGORA });
    expect(await temConsentimentoDeMensagens(ctxPublico(s), clienteId)).toBe(true);
  });
});

describe('CA-9: origem forjada não grava', () => {
  it('equipe pedindo publico e sistema pedindo equipe: RangeError e nenhuma linha', async () => {
    const clienteId = await novaCliente();
    await expect(registrarConsentimento(ctxDoGestor(s), { clienteId, finalidade: 'mensagens_reserva', origem: 'publico', agora: AGORA })).rejects.toBeInstanceOf(RangeError);
    await expect(registrarConsentimento(ctxPublico(s), { clienteId, finalidade: 'mensagens_reserva', origem: 'equipe', agora: AGORA })).rejects.toBeInstanceOf(RangeError);
    expect(await linhasDe(c, clienteId)).toEqual([]);
  });
});
