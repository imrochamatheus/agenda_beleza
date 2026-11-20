import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarBloqueio, editarBloqueio, removerBloqueio } from '@/server/bloqueios/bloqueios.acao';
import { desativarProfissional } from '@/server/profissionais/profissionais.acao';
import type { Credencial } from '@/server/tenant/sessao';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { AGORA, NAO_ENCONTRADO, comHorario, credGestor, inserirBloqueio, linhaBloqueio } from './apoio';

// D-016 T-6: concorrência com PostgreSQL real (CA-20, R-6). Remoção × remoção, criação × desativação
// do profissional (D-013) e edição × remoção. Timeout explícito por `it`: o `npm test` completo roda com
// 4 workers. Nenhum caso pode terminar em exceção (5xx) nem em `deadlock detected`.
//
// Determinismo do caso (b): uma conexão `pg` própria segura a trava da linha; a remoção é disparada e o
// teste espera, por pg_stat_activity, que ela fique bloqueada (wait_event_type = 'Lock') no marcador SQL
// do repositório ("FOR UPDATE OF b") antes de apagar a linha e confirmar.

const TIMEOUT = 30_000;
const MARCADOR = 'FOR UPDATE OF b';
const VEZES = 10;
const exec = { agora: AGORA };

let c: pg.Client;
let trava: pg.Client;
let s: SalaoCompleto;
let g: Credencial;

beforeAll(async () => {
  c = await conectar();
  trava = await conectar();
  s = await criarSalaoCompleto();
  g = await credGestor(s);
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

const novoBloqueio = () =>
  inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: s.profissional.profissionalId, inicio: '2026-12-10T17:00Z', fim: '2026-12-10T19:00Z' });

describe('CA-20: remoção × remoção', () => {
  it(
    '(a) Promise.all ×10: uma remove, a outra dá 404, sem 5xx',
    async () => {
      for (let i = 0; i < VEZES; i += 1) {
        const id = await novoBloqueio();
        const resultados = await Promise.all([removerBloqueio.executar(g, { id }, exec), removerBloqueio.executar(g, { id }, exec)]);
        const ok = resultados.filter((r) => r.ok);
        expect(ok).toEqual([{ ok: true, dados: { resultado: 'removido', id } }]);
        expect(resultados.filter((r) => !r.ok)).toEqual([NAO_ENCONTRADO]);
        expect(await linhaBloqueio(c, id)).toBeUndefined();
      }
    },
    TIMEOUT,
  );

  it(
    '(b) determinístico: a remoção espera a trava da linha; quem a segurava apaga e confirma → 404',
    async () => {
      const id = await novoBloqueio();
      await trava.query('BEGIN');
      await trava.query('SELECT 1 FROM bloqueio WHERE id = $1 FOR UPDATE', [id]);
      const remocao = removerBloqueio.executar(g, { id }, exec);
      await aguardarEsperando(1);
      await trava.query('DELETE FROM bloqueio WHERE id = $1', [id]);
      await trava.query('COMMIT');
      expect(await remocao).toEqual(NAO_ENCONTRADO);
    },
    TIMEOUT,
  );
});

describe('CA-20: criação × desativação do profissional (D-013)', () => {
  it(
    'Promise.all ×10: ambas terminam sem 5xx nem impasse; o bloqueio existe e o profissional fica inativo',
    async () => {
      for (let i = 0; i < VEZES; i += 1) {
        const { rows } = await c.query<{ id: string }>(
          "INSERT INTO profissional (salao_id, nome) VALUES ($1, 'Concorrida') RETURNING id::text AS id",
          [s.salaoId],
        );
        const id = rows[0].id;
        const [criacao, desativacao] = await Promise.all([
          criarBloqueio.executar(g, comHorario('15/12/2026', '10:00', '15/12/2026', '11:00', { alvo: id }), exec),
          desativarProfissional.executar(g, { id }, exec),
        ]);
        expect(criacao).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
        expect(desativacao).toMatchObject({ ok: true });
        const bloqueioId = criacao.ok && criacao.dados.resultado === 'salvo' ? criacao.dados.bloqueio.id : '';
        expect(await linhaBloqueio(c, bloqueioId)).toMatchObject({ profissional_id: id });
        const ativo = await c.query<{ ativo: boolean }>('SELECT ativo FROM profissional WHERE id = $1', [id]);
        expect(ativo.rows[0].ativo).toBe(false);
      }
    },
    TIMEOUT,
  );
});

describe('CA-20: edição × remoção do mesmo bloqueio', () => {
  it(
    'Promise.all ×10: a remoção sempre vence no fim (linha ausente); a edição é salva antes ou dá 404; sem 5xx',
    async () => {
      const desfechos = new Set<string>();
      for (let i = 0; i < VEZES; i += 1) {
        const id = await novoBloqueio();
        const [edicao, remocao] = await Promise.all([
          editarBloqueio.executar(g, { id, ...comHorario('16/12/2026', '10:00', '16/12/2026', '11:00', { motivo: 'Novo' }) }, exec),
          removerBloqueio.executar(g, { id }, exec),
        ]);
        expect(remocao).toEqual({ ok: true, dados: { resultado: 'removido', id } });
        if (edicao.ok) {
          expect(edicao.dados).toMatchObject({ resultado: 'salvo', bloqueio: { id, motivo: 'Novo' } });
          desfechos.add('editada e removida');
        } else {
          expect(edicao).toEqual(NAO_ENCONTRADO);
          desfechos.add('removida antes');
        }
        expect(await linhaBloqueio(c, id)).toBeUndefined();
      }
      expect(desfechos.size).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});
