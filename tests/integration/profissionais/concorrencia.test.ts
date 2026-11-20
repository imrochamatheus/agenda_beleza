import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { desativarProfissional, euTambemAtendo, reativarProfissional } from '@/server/profissionais/profissionais.acao';
import type { Credencial } from '@/server/tenant/sessao';

import { criarSessao, entrarDeVerdade } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { cancelarReservasDoSalao, linhaProfissional, sessoesDe } from './apoio';

// D-013 T-4: concorrência com PostgreSQL real. CA-14 ("eu também atendo" × 10 em paralelo) e CA-17
// (desativar/reativar serializados pela trava FOR UPDATE da linha do profissional). Timeout explícito
// por `it`: o `npm test` completo roda com 4 workers.
//
// CA-17 (R-3 do desenho): uma conexão `pg` própria segura a trava da linha; a 1ª ação é disparada e o
// teste espera, por pg_stat_activity, que ela fique bloqueada (wait_event_type = 'Lock') antes de
// disparar a 2ª. A fila de travas de linha do PostgreSQL é FIFO para o mesmo modo: ao soltar a trava,
// a 1ª termina antes da 2ª e o estado final é o da 2ª.

const TIMEOUT = 30_000;

let c: pg.Client;
let trava: pg.Client;

beforeAll(async () => {
  c = await conectar();
  trava = await conectar();
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

/** Quantas consultas desta base estão esperando trava na linha do profissional (FOR UPDATE OF p). */
async function esperandoTrava(): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE OF p%'`,
  );
  return rows[0].n;
}

async function aguardarEsperando(n: number): Promise<void> {
  const limite = Date.now() + 10_000;
  while ((await esperandoTrava()) < n) {
    if (Date.now() > limite) throw new Error(`esperava ${n} consulta(s) bloqueada(s) na trava`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Disparo = () => Promise<{ ok: boolean }>;

/** Segura a trava, dispara `primeira`, espera ela bloquear, dispara `segunda`, espera e solta. */
async function emFila(profissionalId: string, primeira: Disparo, segunda: Disparo) {
  await trava.query('BEGIN');
  await trava.query('SELECT id FROM profissional WHERE id = $1 FOR UPDATE', [profissionalId]);
  const ordem: string[] = [];
  const p1 = primeira().then((r) => (ordem.push('primeira'), r));
  await aguardarEsperando(1);
  const p2 = segunda().then((r) => (ordem.push('segunda'), r));
  await aguardarEsperando(2);
  await trava.query('COMMIT');
  const resultados = await Promise.all([p1, p2]);
  return { resultados, ordem };
}

async function cenario() {
  const s = await criarSalaoCompleto();
  await cancelarReservasDoSalao(c, s.salaoId);
  const gestor: Credencial = (await criarSessao(s.gestor.usuarioId)).credencial;
  return { s, gestor, id: s.profissional.profissionalId };
}

describe('CA-14: "eu também atendo" em paralelo', () => {
  it(
    'CA-14: dez chamadas simultâneas → 1 criado, 9 já atende, nenhum erro, exatamente um perfil',
    async () => {
      const s = await criarSalaoCompleto({ gestor: { comPerfil: false } });
      const credenciais = await Promise.all(Array.from({ length: 10 }, () => criarSessao(s.gestor.usuarioId)));
      const resultados = await Promise.all(credenciais.map((x) => euTambemAtendo.executar(x.credencial, {})));
      expect(resultados.every((r) => r.ok)).toBe(true);
      const dados = resultados.map((r) => (r.ok ? r.dados : null));
      expect(dados.filter((d) => d?.resultado === 'criado')).toHaveLength(1);
      expect(dados.filter((d) => d?.resultado === 'ja_atende')).toHaveLength(9);
      expect(new Set(dados.map((d) => d?.profissionalId)).size).toBe(1);
      const { rows } = await c.query('SELECT count(*)::int AS n FROM profissional WHERE usuario_id = $1', [s.gestor.usuarioId]);
      expect(rows[0].n).toBe(1);
    },
    TIMEOUT,
  );
});

describe('CA-17: desativar e reativar concorrentes no mesmo profissional', () => {
  it(
    'CA-17: desativar → reativar: a reativação espera e o estado final é ativo',
    async () => {
      const { s, gestor, id } = await cenario();
      await entrarDeVerdade(s.profissional.email);
      const { resultados, ordem } = await emFila(
        id,
        () => desativarProfissional.executar(gestor, { id }),
        () => reativarProfissional.executar(gestor, { id }),
      );
      expect(resultados).toEqual([
        { ok: true, dados: { resultado: 'desativado' } },
        { ok: true, dados: { resultado: 'reativado' } },
      ]);
      expect(ordem).toEqual(['primeira', 'segunda']);
      expect((await linhaProfissional(c, id))!.ativo).toBe(true);
      // A desativação revogou as sessões; reativar não as restaura (RN-10).
      expect((await sessoesDe(c, s.profissional.usuarioId)).every((x) => x.revogada_em !== null)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'CA-17: reativar → desativar: estado final inativo, com as sessões do usuário revogadas',
    async () => {
      const { s, gestor, id } = await cenario();
      await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [id]);
      // Login real exige perfil ativo: a sessão é criada direto (como uma sessão anterior à desativação).
      await criarSessao(s.profissional.usuarioId);
      await criarSessao(s.profissional.usuarioId);
      const { resultados, ordem } = await emFila(
        id,
        () => reativarProfissional.executar(gestor, { id }),
        () => desativarProfissional.executar(gestor, { id }),
      );
      expect(resultados).toEqual([
        { ok: true, dados: { resultado: 'reativado' } },
        { ok: true, dados: { resultado: 'desativado' } },
      ]);
      expect(ordem).toEqual(['primeira', 'segunda']);
      expect((await linhaProfissional(c, id))!.ativo).toBe(false);
      const sessoes = await sessoesDe(c, s.profissional.usuarioId);
      expect(sessoes).toHaveLength(2);
      expect(sessoes.every((x) => x.revogada_em !== null)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'CA-17: duas desativações concorrentes → ambas aceitas (idempotente), inativo, sem erro',
    async () => {
      const { s, gestor, id } = await cenario();
      await entrarDeVerdade(s.profissional.email);
      const { resultados } = await emFila(
        id,
        () => desativarProfissional.executar(gestor, { id }),
        () => desativarProfissional.executar(gestor, { id }),
      );
      expect(resultados).toEqual([
        { ok: true, dados: { resultado: 'desativado' } },
        { ok: true, dados: { resultado: 'desativado' } },
      ]);
      expect((await linhaProfissional(c, id))!.ativo).toBe(false);
      expect((await sessoesDe(c, s.profissional.usuarioId)).every((x) => x.revogada_em !== null)).toBe(true);
    },
    TIMEOUT,
  );
});
