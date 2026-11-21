import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as acoes from '@/server/clientes/clientes.acao';
import { upsertCliente } from '@/server/clientes/servico';
import type { ResultadoEditarCliente, ResultadoUpsertCliente } from '@/server/clientes/tipos';

import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { contarClientes, credGestor, ctxDoGestor, inserirCliente, linhaCliente } from './apoio';

// D-022 T-5: concorrência com PostgreSQL real (CA-6, CA-12, R-1, R-2). Upserts paralelos do mesmo número
// (2 e 10, no mesmo salão e entre salões), edição × edição, edição × upsert e edição cruzada, cada um ×10;
// mais o caso determinístico da edição que perde para um INSERT ainda não confirmado (23505 capturado
// fora da transação). Nenhum caso pode terminar em exceção, impasse ou violação de constraint vazada.

const TIMEOUT = 30_000;
const VEZES = 10;

let c: pg.Client;
let aux: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  aux = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await c.end();
  await aux.end();
});

let sequencia = 0;
/** Telefone novo e único neste arquivo (cada repetição usa o seu). */
const telefone = (): string => `+55119${String(60_000_000 + ++sequencia).padStart(8, '0')}`;

const ok = (r: ResultadoUpsertCliente) => {
  expect(r.resultado).toBe('ok');
  if (r.resultado !== 'ok') throw new Error('esperado ok');
  return r;
};
const edicao = (r: { ok: boolean; dados?: ResultadoEditarCliente }): ResultadoEditarCliente => {
  expect(r.ok).toBe(true);
  return r.dados as ResultadoEditarCliente;
};

describe('CA-6: upserts paralelos do mesmo número', () => {
  it.each([2, 10])(
    '%i em paralelo no mesmo salão ×10: todos resolvem, uma cliente, criada=true em exatamente um, nome de um dos envios',
    async (n) => {
      for (let i = 0; i < VEZES; i += 1) {
        const tel = telefone();
        const nomes = Array.from({ length: n }, (_, k) => `Nome ${k}`);
        const rs = (await Promise.all(nomes.map((nome) => upsertCliente(ctxDoGestor(a), { telefone: tel, nome })))).map(ok);
        expect(await contarClientes(c, a.salaoId, tel)).toBe(1);
        expect(rs.filter((r) => r.criada)).toHaveLength(1);
        expect(new Set(rs.map((r) => r.cliente.id)).size).toBe(1);
        const { rows } = await c.query<{ nome: string }>('SELECT nome FROM cliente WHERE salao_id = $1 AND telefone_e164 = $2', [a.salaoId, tel]);
        expect(nomes).toContain(rows[0].nome);
      }
    },
    TIMEOUT,
  );

  it('o mesmo número em salões diferentes ×10: duas clientes, uma por salão', async () => {
    for (let i = 0; i < VEZES; i += 1) {
      const tel = telefone();
      const rs = (
        await Promise.all([
          upsertCliente(ctxDoGestor(a), { telefone: tel, nome: 'Em A' }),
          upsertCliente(ctxDoGestor(b), { telefone: tel, nome: 'Em B' }),
          upsertCliente(ctxDoGestor(a), { telefone: tel, nome: 'Em A 2' }),
          upsertCliente(ctxDoGestor(b), { telefone: tel, nome: 'Em B 2' }),
        ])
      ).map(ok);
      expect(rs.filter((r) => r.criada)).toHaveLength(2);
      expect(await contarClientes(c, a.salaoId, tel)).toBe(1);
      expect(await contarClientes(c, b.salaoId, tel)).toBe(1);
      expect(rs[0].cliente.id).toBe(rs[2].cliente.id);
      expect(rs[1].cliente.id).toBe(rs[3].cliente.id);
      expect(rs[0].cliente.id).not.toBe(rs[1].cliente.id);
    }
  }, TIMEOUT);
});

describe('CA-12: edição × edição, edição × upsert, edição cruzada', () => {
  it('duas edições (X e Y) para o mesmo telefone livre ×10: uma aceita, a outra telefone_em_uso, um só dono', async () => {
    for (let i = 0; i < VEZES; i += 1) {
      const s = await criarSalaoCompleto();
      const x = s.clientes.ativaId;
      const y = await inserirCliente(c, s.salaoId, 'Y');
      const tel = telefone();
      const cs = await credGestor(s);
      const rs = (
        await Promise.all([
          acoes.editarCliente.executar(cs, { id: x, nome: 'X novo', telefone: tel }),
          acoes.editarCliente.executar(cs, { id: y, nome: 'Y novo', telefone: tel }),
        ])
      ).map(edicao);
      expect(rs.filter((r) => r.resultado === 'ok')).toHaveLength(1);
      expect(rs.filter((r) => r.resultado === 'recusado')).toHaveLength(1);
      const perdedora = rs.find((r) => r.resultado === 'recusado');
      expect(perdedora).toMatchObject({ motivo: 'telefone_em_uso' });
      expect(await contarClientes(c, s.salaoId, tel)).toBe(1);
    }
  }, TIMEOUT);

  it('edição × upsert do mesmo telefone livre ×10: um número, uma cliente; perdedora recusada ou unida à vencedora', async () => {
    let edicaoGanhou = 0;
    let upsertGanhou = 0;
    for (let i = 0; i < VEZES; i += 1) {
      const s = await criarSalaoCompleto();
      const x = s.clientes.ativaId;
      const tel = telefone();
      const cs = await credGestor(s);
      const [e, u] = await Promise.all([
        acoes.editarCliente.executar(cs, { id: x, nome: 'X editada', telefone: tel }),
        upsertCliente(ctxDoGestor(s), { telefone: tel, nome: 'Do upsert' }),
      ]);
      const re = edicao(e);
      const ru = ok(u);
      expect(await contarClientes(c, s.salaoId, tel)).toBe(1);
      if (re.resultado === 'ok') {
        // A edição venceu: o upsert se uniu à cliente X (criada=false) ou rodou depois dela.
        edicaoGanhou += 1;
        expect(ru.criada).toBe(false);
        expect(ru.cliente.id).toBe(x);
      } else {
        // O upsert criou a cliente primeiro; a edição foi recusada (pré-checagem ou 23505 capturado).
        upsertGanhou += 1;
        expect(re).toMatchObject({ resultado: 'recusado', motivo: 'telefone_em_uso', existente: { id: ru.cliente.id } });
        expect(ru.criada).toBe(true);
      }
    }
    expect(edicaoGanhou + upsertGanhou).toBe(VEZES);
  }, TIMEOUT);

  it('duas edições da MESMA cliente (nomes distintos) ×10: termina com um dos dois nomes, sem erro', async () => {
    for (let i = 0; i < VEZES; i += 1) {
      const s = await criarSalaoCompleto();
      const cs = await credGestor(s);
      const id = s.clientes.ativaId;
      const tel = telefone();
      const rs = (
        await Promise.all([
          acoes.editarCliente.executar(cs, { id, nome: 'Primeira', telefone: tel }),
          acoes.editarCliente.executar(cs, { id, nome: 'Segunda', telefone: tel }),
        ])
      ).map(edicao);
      expect(rs.every((r) => r.resultado === 'ok')).toBe(true);
      expect(['Primeira', 'Segunda']).toContain((await linhaCliente(c, id)).nome);
      expect(await contarClientes(c, s.salaoId, tel)).toBe(1);
    }
  }, TIMEOUT);

  it('edição cruzada (X: A→B, Y: B→A) ×10: sem impasse; ambas recusadas e nada trocado', async () => {
    for (let i = 0; i < VEZES; i += 1) {
      const s = await criarSalaoCompleto();
      const ta = telefone();
      const tb = telefone();
      const x = s.clientes.ativaId;
      await c.query('UPDATE cliente SET telefone_e164 = $2 WHERE id = $1', [x, ta]);
      const y = await inserirCliente(c, s.salaoId, 'Y', tb);
      const cs = await credGestor(s);
      const rs = (
        await Promise.all([
          acoes.editarCliente.executar(cs, { id: x, nome: 'Xis', telefone: tb }),
          acoes.editarCliente.executar(cs, { id: y, nome: 'Yps', telefone: ta }),
        ])
      ).map(edicao);
      expect(rs, JSON.stringify(rs)).toSatisfy((l: ResultadoEditarCliente[]) => l.every((r) => r.resultado === 'recusado'));
      expect((await linhaCliente(c, x)).telefone_e164).toBe(ta);
      expect((await linhaCliente(c, y)).telefone_e164).toBe(tb);
    }
  }, TIMEOUT);

  it('determinístico: edição bloqueada por um INSERT ainda não confirmado do mesmo telefone → recusada (23505 capturado)', async () => {
    const s = await criarSalaoCompleto();
    const tel = telefone();
    const cs = await credGestor(s);
    await aux.query('BEGIN');
    try {
      await aux.query('INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, $2, $3)', [s.salaoId, 'Vencedora', tel]);
      const pendente = acoes.editarCliente.executar(cs, { id: s.clientes.ativaId, nome: 'Perdedora', telefone: tel });
      const limite = Date.now() + 10_000;
      for (;;) {
        const { rows } = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%UPDATE cliente SET nome%'`,
        );
        if (rows[0].n >= 1) break;
        if (Date.now() > limite) throw new Error('a edição não chegou a esperar o INSERT não confirmado');
        await new Promise((r) => setTimeout(r, 20));
      }
      await aux.query('COMMIT');
      const r = edicao(await pendente);
      const { rows } = await c.query<{ id: string }>('SELECT id::text AS id FROM cliente WHERE salao_id = $1 AND telefone_e164 = $2', [s.salaoId, tel]);
      expect(r).toEqual({ resultado: 'recusado', motivo: 'telefone_em_uso', existente: { id: rows[0].id, nome: 'Vencedora' } });
      // A transação inteira da edição foi desfeita: a cliente X segue como estava.
      expect((await linhaCliente(c, s.clientes.ativaId)).telefone_e164).toBe(s.clientes.telefoneAtiva);
    } finally {
      await aux.query('ROLLBACK').catch(() => undefined);
    }
  }, TIMEOUT);
});
