import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { salvarJornada } from '@/server/jornadas/jornadas.acao';
import { desativarProfissional } from '@/server/profissionais/profissionais.acao';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, erroSql } from '../../support/sql';

import { faixasJornada, semana } from './apoio';
import type { SemanaTexto } from './apoio';

// D-015 T-4: concorrência com PostgreSQL real. CA-13 (R-1: duas gravações da mesma jornada; R-2:
// gravação × desativação, D-013) e R-3 (compatibilidade da trava FOR NO KEY UPDATE com o FOR KEY SHARE
// de inserções de reserva). Timeout explícito por `it`: o `npm test` completo roda com 4 workers.
//
// Determinismo: uma conexão `pg` própria segura a trava; as gravações são disparadas uma a uma e o
// teste espera, por pg_stat_activity, que cada uma fique bloqueada (wait_event_type = 'Lock') no
// marcador SQL do repositório ("FOR NO KEY UPDATE OF pj") antes de seguir. A fila de travas é FIFO.

const TIMEOUT = 30_000;
const MARCADOR = 'FOR NO KEY UPDATE OF pj';

const S1: SemanaTexto = { 1: [['09:00', '12:00'], ['13:00', '18:00']], 2: [['09:00', '12:00']] };
const S2: SemanaTexto = { 1: [['10:00', '16:00']], 3: [['08:00', '12:00'], ['14:00', '20:00']], 5: [['22:00', '24:00']] };
const FAIXAS_S1 = [
  [1, 540, 720],
  [1, 780, 1080],
  [2, 540, 720],
];
const FAIXAS_S2 = [
  [1, 600, 960],
  [3, 480, 720],
  [3, 840, 1200],
  [5, 1320, 1440],
];

let c: pg.Client;
let trava: pg.Client;
let s: SalaoCompleto;
let g: Credencial;

beforeAll(async () => {
  c = await conectar();
  trava = await conectar();
  s = await criarSalaoCompleto();
  g = await credencialDoGestor(s);
});
afterAll(async () => {
  await trava.end();
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Quantas consultas desta base estão esperando trava com o marcador SQL. */
async function esperando(): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1`,
    [`%${MARCADOR}%`],
  );
  return rows[0].n;
}

async function aguardarEsperando(n: number): Promise<void> {
  const limite = Date.now() + 10_000;
  while ((await esperando()) < n) {
    if (Date.now() > limite) throw new Error(`esperava ${n} consulta(s) bloqueada(s) em "${MARCADOR}"`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Profissional novo do salão, ativo, sem usuário, sem jornada e sem reservas. */
async function novoProfissional(): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    "INSERT INTO profissional (salao_id, nome) VALUES ($1, 'Concorrida') RETURNING id::text AS id",
    [s.salaoId],
  );
  return rows[0].id;
}

async function ativo(id: string): Promise<boolean> {
  const { rows } = await c.query<{ ativo: boolean }>('SELECT ativo FROM profissional WHERE id = $1', [id]);
  return rows[0].ativo;
}

const salvar = (id: string, dias: SemanaTexto) => salvarJornada.executar(g, semana(id, dias));

describe('CA-13 (R-1): duas gravações da jornada do mesmo profissional', () => {
  it(
    'R-1 (a): em fila na trava do profissional, a 2ª gravação vence; as duas são aceitas',
    async () => {
      const id = await novoProfissional();
      await trava.query('BEGIN');
      await trava.query('SELECT 1 FROM profissional WHERE id = $1 FOR UPDATE', [id]);
      const ordem: string[] = [];
      const g1 = salvar(id, S1).then((r) => (ordem.push('1'), r));
      await aguardarEsperando(1);
      const g2 = salvar(id, S2).then((r) => (ordem.push('2'), r));
      await aguardarEsperando(2);
      await trava.query('ROLLBACK');
      const resultados = await Promise.all([g1, g2]);
      expect(resultados.map((r) => r.ok && r.dados.resultado)).toEqual(['salvo', 'salvo']);
      expect(ordem).toEqual(['1', '2']);
      expect(await faixasJornada(c, id)).toEqual(FAIXAS_S2);
    },
    TIMEOUT,
  );

  it(
    'R-1 (b): Promise.all ×10 → ambas salvas, sem 5xx nem 23P01, e a final é exatamente uma das duas',
    async () => {
      for (let i = 0; i < 10; i++) {
        const id = await novoProfissional();
        const resultados = await Promise.all([salvar(id, S1), salvar(id, S2)]);
        expect(resultados.map((r) => r.ok && r.dados.resultado)).toEqual(['salvo', 'salvo']);
        expect([FAIXAS_S1, FAIXAS_S2]).toContainEqual(await faixasJornada(c, id));
      }
    },
    TIMEOUT,
  );

  it(
    'R-1 (b): Promise.all ×10 partindo de uma jornada existente (DELETE + INSERT cruzados) → sem mistura',
    async () => {
      for (let i = 0; i < 10; i++) {
        const id = await novoProfissional();
        expect((await salvar(id, { 1: [['08:00', '20:00']], 3: [['09:00', '10:00']] })).ok).toBe(true);
        const resultados = await Promise.all([salvar(id, S1), salvar(id, S2)]);
        expect(resultados.map((r) => r.ok && r.dados.resultado)).toEqual(['salvo', 'salvo']);
        expect([FAIXAS_S1, FAIXAS_S2]).toContainEqual(await faixasJornada(c, id));
      }
    },
    TIMEOUT,
  );
});

describe('CA-13 (R-2): gravação × desativação do mesmo profissional (D-013)', () => {
  it(
    'R-2: Promise.all(salvar, desativar) ×10 → ambas ok, sem impasse; inativo e jornada = semana salva',
    async () => {
      for (let i = 0; i < 10; i++) {
        const id = await novoProfissional();
        const [gravacao, desativacao] = await Promise.all([salvar(id, S2), desativarProfissional.executar(g, { id })]);
        expect(gravacao).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
        expect(desativacao).toEqual({ ok: true, dados: { resultado: 'desativado' } });
        expect(await ativo(id)).toBe(false);
        expect(await faixasJornada(c, id)).toEqual(FAIXAS_S2);
      }
    },
    TIMEOUT,
  );

  it(
    'R-2: a desativação segura a linha; a gravação espera e, depois do COMMIT, é aceita (RN-13)',
    async () => {
      const id = await novoProfissional();
      await trava.query('BEGIN');
      await trava.query('UPDATE profissional SET ativo = false WHERE id = $1', [id]);
      const gravacao = salvar(id, S1);
      await aguardarEsperando(1);
      await trava.query('COMMIT');
      expect(await gravacao).toMatchObject({ ok: true, dados: { resultado: 'salvo', inseridos: 3 } });
      expect(await ativo(id)).toBe(false);
      expect(await faixasJornada(c, id)).toEqual(FAIXAS_S1);
    },
    TIMEOUT,
  );
});

describe('R-3: a trava da gravação não atrasa inserções de reserva', () => {
  it(
    'R-3: com FOR NO KEY UPDATE seguro, FOR KEY SHARE NOWAIT passa; FOR SHARE e FOR UPDATE NOWAIT → 55P03',
    async () => {
      const id = await novoProfissional();
      await trava.query('BEGIN');
      try {
        await trava.query('SELECT 1 FROM profissional pj WHERE pj.id = $1 FOR NO KEY UPDATE OF pj', [id]);
        // FOR KEY SHARE é a trava de uma inserção em reserva/jornada/convite que referencia o profissional.
        const { rows } = await c.query('SELECT id::text AS id FROM profissional WHERE id = $1 FOR KEY SHARE NOWAIT', [id]);
        expect(rows).toEqual([{ id }]);
        // A conferência FOR SHARE (E3.2) e a desativação FOR UPDATE (D-013) serializam com a gravação.
        expect((await erroSql(c.query('SELECT 1 FROM profissional WHERE id = $1 FOR SHARE NOWAIT', [id]))).code).toBe('55P03');
        expect((await erroSql(c.query('SELECT 1 FROM profissional WHERE id = $1 FOR UPDATE NOWAIT', [id]))).code).toBe('55P03');
      } finally {
        await trava.query('ROLLBACK');
      }
    },
    TIMEOUT,
  );
});
