import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { upsertCliente } from '@/server/clientes/servico';
import { MENSAGENS_CLIENTE } from '@/server/clientes/tipos';
import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import { contextoDeSistema } from '@/server/tenant/context';

import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { anonimizarPorSql, contarClientes, ctxDoGestor, fotografiaReservas, linhaCliente } from './apoio';

// D-022 T-5: upsertCliente contra PostgreSQL real. CA-2 (via upsert), CA-3, CA-4, CA-15, RN-5..RN-7.

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(async () => {
  await c.end();
});

describe('CA-3: atualiza o nome da cliente existente', () => {
  it('mesmo número em outra máscara: uma só cliente, mesmo id, nome normalizado, criada=false, atualizado_em avança', async () => {
    const s = await criarSalaoCompleto({ cliente: { nome: 'Maria', telefoneE164: '+5511987654321' } });
    const antes = await linhaCliente(c, s.clientes.ativaId);
    const r = await upsertCliente(ctxDoGestor(s), { telefone: '(11) 98765-4321', nome: '  Maria   S. ' });
    expect(r).toEqual({
      resultado: 'ok',
      cliente: { id: s.clientes.ativaId, nome: 'Maria S.', telefoneE164: '+5511987654321' },
      criada: false,
    });
    expect(await contarClientes(c, s.salaoId, '+5511987654321')).toBe(1);
    const depois = await linhaCliente(c, s.clientes.ativaId);
    expect(depois.nome).toBe('Maria S.');
    expect(new Date(depois.atualizado_em as string).getTime()).toBeGreaterThan(new Date(antes.atualizado_em as string).getTime());
    expect(depois.criado_em).toBe(antes.criado_em);
  });

  it('número novo: cria, criada=true, E.164 gravado', async () => {
    const s = await criarSalaoCompleto();
    const r = await upsertCliente(ctxDoGestor(s), { telefone: '+55 21 91234-5678', nome: 'Beatriz Nova' });
    expect(r).toMatchObject({ resultado: 'ok', criada: true, cliente: { nome: 'Beatriz Nova', telefoneE164: '+5521912345678' } });
    expect(await contarClientes(c, s.salaoId, '+5521912345678')).toBe(1);
  });

  it.each([[''], ['A'], ['a'.repeat(101)], ['Ma\nria'], [undefined], [42]])('nome %j → invalido no campo nome, sem escrita', async (nome) => {
    const s = await criarSalaoCompleto();
    const total = await contarClientes(c, s.salaoId);
    const r = await upsertCliente(ctxDoGestor(s), { telefone: '11987654321', nome });
    expect(r).toMatchObject({ resultado: 'invalido', erros: { nome: expect.any(String) } });
    expect(await contarClientes(c, s.salaoId)).toBe(total);
  });
});

describe('CA-2: telefone inválido pelo upsert', () => {
  it.each(['+1 415 555 0100', '(00) 98765-4321', '(20) 98765-4321', '0800 123 4567', '(11) 8765-432', '(11) 88765-4321', 'abc', '9'.repeat(31), null, {}])(
    '%j → erro no campo telefone, nada gravado',
    async (telefone) => {
      const s = await criarSalaoCompleto();
      const antes = await linhaCliente(c, s.clientes.ativaId);
      const total = await contarClientes(c, s.salaoId);
      expect(await upsertCliente(ctxDoGestor(s), { telefone, nome: 'Ana Lima' })).toEqual({
        resultado: 'invalido',
        erros: { telefone: MENSAGENS_CLIENTE.telefone },
      });
      expect(await contarClientes(c, s.salaoId)).toBe(total);
      expect(await linhaCliente(c, s.clientes.ativaId)).toEqual(antes);
    },
  );
});

describe('CA-4 / CA-15: isolamento', () => {
  it('o mesmo número em dois salões gera clientes independentes; upsert em A não altera B', async () => {
    const tel = '+5511955550001';
    const ra = await upsertCliente(ctxDoGestor(a), { telefone: tel, nome: 'Cliente A' });
    const rb = await upsertCliente(ctxDoGestor(b), { telefone: tel, nome: 'Cliente B' });
    expect(ra).toMatchObject({ resultado: 'ok', criada: true });
    expect(rb).toMatchObject({ resultado: 'ok', criada: true });
    if (ra.resultado !== 'ok' || rb.resultado !== 'ok') throw new Error('esperado ok');
    expect(ra.cliente.id).not.toBe(rb.cliente.id);
    const antesB = await linhaCliente(c, rb.cliente.id);
    const r2 = await upsertCliente(ctxDoGestor(a), { telefone: tel, nome: 'Outro Nome A' });
    expect(r2).toMatchObject({ resultado: 'ok', criada: false, cliente: { id: ra.cliente.id, nome: 'Outro Nome A' } });
    expect(await linhaCliente(c, rb.cliente.id)).toEqual(antesB);
  });

  it('salaoId forjado na entrada é ignorado: só o salão do contexto é afetado', async () => {
    const tel = '+5511955550002';
    const antesA = await contarClientes(c, a.salaoId);
    const r = await upsertCliente(ctxDoGestor(b), { telefone: tel, nome: 'Forjada', salaoId: a.salaoId } as never);
    expect(r).toMatchObject({ resultado: 'ok', criada: true });
    expect(await contarClientes(c, a.salaoId)).toBe(antesA);
    expect(await contarClientes(c, b.salaoId, tel)).toBe(1);
    expect(await contarClientes(c, a.salaoId, tel)).toBe(0);
  });

  it('salão inexistente: erro de escopo do banco (FK), nenhuma cliente criada', async () => {
    const ctx = contextoDeSistema('00000000-0000-4000-8000-0000000000aa', 'reserva_publica');
    await expect(upsertCliente(ctx, { telefone: '11987654321', nome: 'Ana Lima' })).rejects.toThrow();
  });
});

describe('RN-6, RN-7: contexto de sistema, transação do chamador, sem efeito colateral', () => {
  it('SistemaContext (E4.2) cria a cliente no salão do contexto', async () => {
    const s = await criarSalaoCompleto();
    const r = await upsertCliente(contextoDeSistema(s.salaoId, 'reserva_publica'), { telefone: '(31) 98888-1111', nome: 'Pública' });
    expect(r).toMatchObject({ resultado: 'ok', criada: true });
    expect(await contarClientes(c, s.salaoId, '+5531988881111')).toBe(1);
  });

  it('dentro da transação do chamador: desfeito junto com ela', async () => {
    const s = await criarSalaoCompleto();
    const tel = '+5531988882222';
    await expect(
      emTransacao(async (t) => {
        const r = await upsertCliente(ctxDoGestor(s), { telefone: tel, nome: 'Na transação' }, t);
        expect(r).toMatchObject({ resultado: 'ok', criada: true });
        throw new Error('desfaz');
      }),
    ).rejects.toThrow('desfaz');
    expect(await contarClientes(c, s.salaoId, tel)).toBe(0);
    const ok = await emTransacao((t) => upsertCliente(ctxDoGestor(s), { telefone: tel, nome: 'Na transação' }, t));
    expect(ok).toMatchObject({ resultado: 'ok', criada: true });
    expect(await contarClientes(c, s.salaoId, tel)).toBe(1);
  });

  it('não toca reservas, itens nem mensagens; número de anonimizada não conflita', async () => {
    const s = await criarSalaoCompleto();
    await anonimizarPorSql(c, s.clientes.anonimizadaId);
    const antesAnon = await linhaCliente(c, s.clientes.anonimizadaId);
    const antes = await fotografiaReservas(c, s.salaoId);
    const r = await upsertCliente(ctxDoGestor(s), { telefone: s.clientes.telefoneAtiva, nome: 'Mesma Pessoa' });
    expect(r).toMatchObject({ resultado: 'ok', criada: false });
    const nova = await upsertCliente(ctxDoGestor(s), { telefone: '+5511999990000', nome: 'Nova' });
    expect(nova).toMatchObject({ resultado: 'ok', criada: true });
    expect(await fotografiaReservas(c, s.salaoId)).toEqual(antes);
    expect(await linhaCliente(c, s.clientes.anonimizadaId)).toEqual(antesAnon);
  });

  it('o repositório recusa telefone fora do E.164 brasileiro antes de consultar', async () => {
    await expect(repos().clientes.upsert(ctxDoGestor(a), { nome: 'X', telefoneE164: '11987654321' })).rejects.toThrow(RangeError);
  });
});
