import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { desativarProfissional, reativarProfissional } from '@/server/profissionais/profissionais.acao';
import { editarServico } from '@/server/servicos/servicos.acao';
import { MENSAGENS_SERVICO } from '@/server/servicos/tipos';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { cancelarReservasDoSalao } from '../profissionais/apoio';
import { fotografiaServico, inserirProfissional, inserirServico, linhaServico, vinculosDe } from './apoio';

// D-014 T-4: concorrência com PostgreSQL real. CA-15 (duas edições do mesmo serviço), R-2 (vínculo ×
// desativação do profissional) e R-3 (sem impasse com a D-013). Timeout explícito por `it`: o
// `npm test` completo roda com 4 workers.
//
// Determinismo (R-1, R-2): uma conexão `pg` própria segura a trava; as edições são disparadas uma a
// uma e o teste espera, por pg_stat_activity, que cada uma fique bloqueada (wait_event_type = 'Lock')
// no marcador SQL do repositório antes de seguir. A fila de travas de linha é FIFO.

const TIMEOUT = 30_000;
const M = MENSAGENS_SERVICO;

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

/** Quantas consultas desta base estão esperando trava com o marcador SQL dado. */
async function esperando(marcador: string): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1`,
    [`%${marcador}%`],
  );
  return rows[0].n;
}

async function aguardarEsperando(marcador: string, n: number): Promise<void> {
  const limite = Date.now() + 10_000;
  while ((await esperando(marcador)) < n) {
    if (Date.now() > limite) throw new Error(`esperava ${n} consulta(s) bloqueada(s) em "${marcador}"`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Cenario = { s: SalaoCompleto; g: Credencial; servico: string; p1: string; p2: string; p3: string };

async function cenario(): Promise<Cenario> {
  const s = await criarSalaoCompleto();
  const g = await credencialDoGestor(s);
  const servico = await inserirServico(c, s.salaoId, { nome: 'Disputado' });
  const p3 = await inserirProfissional(c, s.salaoId, 'Terceira');
  return { s, g, servico, p1: s.profissional.profissionalId, p2: s.gestor.profissionalId!, p3 };
}

const entrada = (id: string, nome: string, profissionais: string[]) => ({ id, nome, preco: '50,00', duracao: '30', profissionais });

describe('CA-15: duas edições do mesmo serviço', () => {
  it(
    'CA-15 (a): em fila na trava do serviço, a 2ª edição vence: conjunto final = o da 2ª, ambas sem erro',
    async () => {
      const { g, servico, p1, p2, p3 } = await cenario();
      await trava.query('BEGIN');
      await trava.query('SELECT id FROM servico WHERE id = $1 FOR UPDATE', [servico]);
      const ordem: string[] = [];
      const e1 = editarServico.executar(g, entrada(servico, 'Primeira', [p1, p2])).then((r) => (ordem.push('1'), r));
      await aguardarEsperando('FOR NO KEY UPDATE OF s', 1);
      const e2 = editarServico.executar(g, entrada(servico, 'Segunda', [p2, p3])).then((r) => (ordem.push('2'), r));
      await aguardarEsperando('FOR NO KEY UPDATE OF s', 2);
      await trava.query('ROLLBACK');
      const resultados = await Promise.all([e1, e2]);
      expect(resultados.map((r) => r.ok && r.dados.resultado)).toEqual(['salvo', 'salvo']);
      expect(ordem).toEqual(['1', '2']);
      expect(await vinculosDe(c, servico)).toEqual([p2, p3].sort());
      expect((await linhaServico(c, servico))!.nome).toBe('Segunda');
    },
    TIMEOUT,
  );

  it(
    'CA-15 (b): Promise.all de duas edições → ambas ok e o conjunto final é exatamente um dos dois',
    async () => {
      for (let i = 0; i < 5; i++) {
        const { g, servico, p1, p2, p3 } = await cenario();
        const conjuntos = [[p1, p2].sort(), [p3].sort()];
        const resultados = await Promise.all([
          editarServico.executar(g, entrada(servico, 'Edição A', conjuntos[0])),
          editarServico.executar(g, entrada(servico, 'Edição B', conjuntos[1])),
        ]);
        expect(resultados.map((r) => r.ok && r.dados.resultado)).toEqual(['salvo', 'salvo']);
        const final = await vinculosDe(c, servico);
        expect(conjuntos).toContainEqual(final);
        const nome = (await linhaServico(c, servico))!.nome;
        expect(final).toEqual(conjuntos[nome === 'Edição A' ? 0 : 1]);
      }
    },
    TIMEOUT,
  );
});

describe('R-2: vincular × desativar o mesmo profissional', () => {
  it(
    'R-2: a desativação confirma antes → a edição que marca P é recusada, sem vínculo nem alteração do serviço',
    async () => {
      const { g, servico, p3 } = await cenario();
      const antes = await fotografiaServico(c, servico);
      await trava.query('BEGIN');
      await trava.query('UPDATE profissional SET ativo = false WHERE id = $1', [p3]);
      const edicao = editarServico.executar(g, entrada(servico, 'Com P', [p3]));
      await aguardarEsperando('FOR SHARE OF p', 1);
      await trava.query('COMMIT');
      expect(await edicao).toEqual({ ok: true, dados: { resultado: 'invalido', erros: { profissionais: M.profissionais } } });
      expect(await fotografiaServico(c, servico)).toEqual(antes);
    },
    TIMEOUT,
  );

  it(
    'R-2: a desativação é desfeita → a edição é aceita e o vínculo existe',
    async () => {
      const { g, servico, p3 } = await cenario();
      await trava.query('BEGIN');
      await trava.query('UPDATE profissional SET ativo = false WHERE id = $1', [p3]);
      const edicao = editarServico.executar(g, entrada(servico, 'Com P', [p3]));
      await aguardarEsperando('FOR SHARE OF p', 1);
      await trava.query('ROLLBACK');
      expect(await edicao).toMatchObject({ ok: true, dados: { resultado: 'salvo', servico: { profissionaisAtivos: 1 } } });
      expect(await vinculosDe(c, servico)).toEqual([p3]);
    },
    TIMEOUT,
  );
});

describe('R-3: sem impasse com a desativação de profissional (D-013)', () => {
  it(
    'R-3: 10 edições paralelas em 2 serviços com profissionais em comum + desativar/reativar um deles → nenhum erro',
    async () => {
      const { s, g, servico, p1, p2, p3 } = await cenario();
      await cancelarReservasDoSalao(c, s.salaoId);
      const outro = await inserirServico(c, s.salaoId, { nome: 'Outro disputado' });
      const conjuntos = [[p1, p2], [p2, p3], [p3, p1], [p1, p2, p3], [p2]];
      const edicoes = Array.from({ length: 10 }, (_, i) =>
        editarServico.executar(g, entrada(i % 2 === 0 ? servico : outro, `E${i}`, conjuntos[i % conjuntos.length])),
      );
      const situacao = (async () => [
        await desativarProfissional.executar(g, { id: p2 }),
        await reativarProfissional.executar(g, { id: p2 }),
      ])();
      const resultados = await Promise.allSettled([...edicoes, situacao]);
      const rejeitados = resultados.filter((r) => r.status === 'rejected');
      expect(rejeitados.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
      for (const r of resultados.slice(0, 10)) {
        const v = (r as PromiseFulfilledResult<Awaited<ReturnType<typeof editarServico.executar>>>).value;
        // Salvo, ou recusado por campo se p2 estava inativo no momento da trava: nunca 5xx.
        expect(v.ok).toBe(true);
        if (v.ok) expect(['salvo', 'invalido']).toContain(v.dados.resultado);
      }
      const [desativou, reativou] = (resultados[10] as PromiseFulfilledResult<{ ok: boolean }[]>).value;
      expect([desativou.ok, reativou.ok]).toEqual([true, true]);
    },
    TIMEOUT,
  );
});
