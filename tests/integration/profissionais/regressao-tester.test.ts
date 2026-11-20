import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  criarProfissional,
  desativarProfissional,
  editarProfissional,
  euTambemAtendo,
  reativarProfissional,
} from '@/server/profissionais/profissionais.acao';
import type { Credencial } from '@/server/tenant/sessao';

import { criarSessao } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto, instanteFuturo } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { cancelarReservasDoSalao, fotografiaDoSalao, linhaProfissional } from './apoio';

// D-013 T-8 (tester): regressão independente.
// - D-7: desativação × inserção de reserva ainda não confirmada (FOR UPDATE espera o FOR KEY SHARE da
//   inserção; ao obter a trava enxerga o commit e recusa; com rollback, desativa).
// - Isolamento extra: "eu também atendo" do gestor de A não toca B; entradas com tipos errados/campos
//   extras não geram 5xx nem gravam.

const TIMEOUT = 30_000;

let c: pg.Client;
let tx: pg.Client;

beforeAll(async () => {
  c = await conectar();
  tx = await conectar();
});
afterAll(async () => {
  await tx.end();
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function esperandoTrava(): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE OF p%'`,
  );
  return rows[0].n;
}

async function aguardarEsperando(): Promise<void> {
  const limite = Date.now() + 10_000;
  while ((await esperandoTrava()) < 1) {
    if (Date.now() > limite) throw new Error('a desativação não ficou esperando a trava');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function gestor(s: SalaoCompleto): Promise<Credencial> {
  return (await criarSessao(s.gestor.usuarioId)).credencial;
}

/** Abre uma transação em `tx` que insere uma reserva confirmada futura (sem commit). */
async function inserirReservaSemCommit(s: SalaoCompleto): Promise<void> {
  const inicio = instanteFuturo(5, 15);
  const fim = new Date(inicio.getTime() + 30 * 60_000);
  await tx.query('BEGIN');
  await tx.query(
    `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
     VALUES ($1, $2, $3, $4, $5, $5, 'confirmado', 'equipe')`,
    [s.salaoId, s.profissional.profissionalId, s.clientes.ativaId, inicio, fim],
  );
}

describe('D-7: desativação concorrente com inserção de reserva', () => {
  it(
    'a desativação espera a inserção; com commit, recusa listando a reserva nova e nada muda',
    async () => {
      const s = await criarSalaoCompleto();
      await cancelarReservasDoSalao(c, s.salaoId);
      const g = await gestor(s);
      const id = s.profissional.profissionalId;
      await inserirReservaSemCommit(s);
      const p = desativarProfissional.executar(g, { id });
      await aguardarEsperando();
      await tx.query('COMMIT');
      const r = await p;
      expect(r.ok).toBe(true);
      expect(r.ok && r.dados.resultado).toBe('recusado');
      expect(r.ok && r.dados.resultado === 'recusado' && r.dados.reservas).toHaveLength(1);
      expect((await linhaProfissional(c, id))!.ativo).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'com rollback da inserção, a desativação é aceita',
    async () => {
      const s = await criarSalaoCompleto();
      await cancelarReservasDoSalao(c, s.salaoId);
      const g = await gestor(s);
      const id = s.profissional.profissionalId;
      await inserirReservaSemCommit(s);
      const p = desativarProfissional.executar(g, { id });
      await aguardarEsperando();
      await tx.query('ROLLBACK');
      expect(await p).toEqual({ ok: true, dados: { resultado: 'desativado' } });
      expect((await linhaProfissional(c, id))!.ativo).toBe(false);
    },
    TIMEOUT,
  );
});

describe('isolamento e entradas hostis (regressão do tester)', () => {
  it('gestor de A: "eu também atendo", criar, editar, desativar e reativar nunca alteram B', async () => {
    const { a, b } = await criarDoisSaloes();
    await cancelarReservasDoSalao(c, a.salaoId);
    const antesB = await fotografiaDoSalao(c, b.salaoId);
    const g = await gestor(a);
    await euTambemAtendo.executar(g, {});
    await criarProfissional.executar(g, { nome: 'Nova de A' });
    for (const id of [b.profissional.profissionalId, b.gestor.profissionalId!, b.profissionalInativoId]) {
      expect(await editarProfissional.executar(g, { id, nome: 'Invasora' })).toEqual({
        ok: false,
        erro: 'nao_encontrado',
        status: 404,
      });
      expect(await desativarProfissional.executar(g, { id })).toEqual({ ok: false, erro: 'nao_encontrado', status: 404 });
      expect(await reativarProfissional.executar(g, { id })).toEqual({ ok: false, erro: 'nao_encontrado', status: 404 });
    }
    expect(await fotografiaDoSalao(c, b.salaoId)).toEqual(antesB);
  });

  it('tipos errados, campos extras e ids estranhos → invalido/404, nunca exceção; nada gravado', async () => {
    const s = await criarSalaoCompleto();
    const g = await gestor(s);
    const antes = await fotografiaDoSalao(c, s.salaoId);
    const entradas: unknown[] = [
      null,
      'texto',
      [],
      { nome: 123 },
      { nome: 'Ana', email: 42 },
      { nome: 'Ana', salaoId: '00000000-0000-0000-0000-000000000000' },
      { nome: 'Ana', usuarioId: s.gestor.usuarioId },
      { nome: 'Ana', ativo: false },
      { nome: 'An\u0000a' },
    ];
    for (const e of entradas) {
      const r = await criarProfissional.executar(g, e as never);
      expect(r.ok && r.dados.resultado).toBe('invalido');
    }
    const id = s.profissional.profissionalId;
    for (const e of [
      { id, nome: 'Ana', usuarioId: s.gestor.usuarioId },
      { id, nome: 'Ana', ativo: false },
    ]) {
      const r = await editarProfissional.executar(g, e as never);
      expect(r.ok && r.dados.resultado).toBe('invalido');
    }
    for (const idRuim of [
      { id: 1 },
      { id: null },
      { id: ['x'] },
      { id: "' OR 1=1 --" },
      { id: `${id} ` },
      { id: id.toUpperCase() },
    ]) {
      const r = await desativarProfissional.executar(g, idRuim as never);
      // UUID em maiúsculas é o mesmo UUID para o PostgreSQL: aceitável qualquer resultado não-5xx.
      expect(r.ok || r.erro === 'nao_encontrado').toBe(true);
      if (idRuim.id === id.toUpperCase()) continue;
      expect(r).toEqual({ ok: false, erro: 'nao_encontrado', status: 404 });
    }
    const depois = (await fotografiaDoSalao(c, s.salaoId)) as { profissionais: unknown[] };
    // O UUID em maiúsculas pode ter desativado (reserva da fábrica bloqueia; então nada muda).
    expect(depois).toEqual(antes);
  });
});
