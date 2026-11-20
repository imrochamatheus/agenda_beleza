import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { salvarConfiguracoes, trocarSlugDoSalao } from '@/server/salao/configuracoes.acao';
import { MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';
import type { Credencial } from '@/server/tenant/sessao';

import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { MANAUS, atuaisDe, credGestor, definirSlugAtual, donoDoSlug, linhaSalao, regras, slugsDe } from './apoio';

// D-017 T-6: concorrência com PostgreSQL real (CA-12, CA-13, R-1..R-3). Disputa do mesmo slug entre
// salões, trocas no mesmo salão, troca cruzada e regras × slug, cada uma ×10; mais os casos
// determinísticos com a trava segurada por uma conexão `pg` própria e pg_stat_activity. Timeout explícito
// por `it` (o `npm test` completo roda com 4 workers). Nenhum caso pode terminar em exceção (5xx),
// `deadlock detected` nem violação de constraint vazada: toda resposta tem de ser { ok: true }.

const TIMEOUT = 30_000;
const MARCADOR = 'FOR NO KEY UPDATE';
const VEZES = 10;

let c: pg.Client;
let trava: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;
let ga: Credencial;
let gb: Credencial;

beforeAll(async () => {
  c = await conectar();
  trava = await conectar();
  ({ a, b } = await criarDoisSaloes());
  ga = await credGestor(a);
  gb = await credGestor(b);
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

const trocado = (slug: string) => ({ ok: true, dados: { resultado: 'trocado', slug } });
const emUso = { ok: true, dados: { resultado: 'invalido', erros: { slug: M.slugEmUso } } };

describe('CA-12: dois salões pedem o mesmo slug', () => {
  it(
    'Promise.all ×10: exatamente um vence; o outro recebe "em uso" e mantém o slug anterior',
    async () => {
      const vencedores = new Set<string>();
      for (let i = 0; i < VEZES; i += 1) {
        const alvo = `disputado-${i}`;
        const [antesA] = await atuaisDe(c, a.salaoId);
        const [antesB] = await atuaisDe(c, b.salaoId);
        const [ra, rb] = await Promise.all([trocarSlugDoSalao.executar(ga, { slug: alvo }), trocarSlugDoSalao.executar(gb, { slug: alvo })]);
        const resultados = [ra, rb];
        expect(resultados.filter((r) => JSON.stringify(r) === JSON.stringify(trocado(alvo)))).toHaveLength(1);
        expect(resultados.filter((r) => JSON.stringify(r) === JSON.stringify(emUso))).toHaveLength(1);
        const vencedor = JSON.stringify(ra) === JSON.stringify(trocado(alvo)) ? a : b;
        const perdedor = vencedor === a ? b : a;
        vencedores.add(vencedor === a ? 'a' : 'b');
        expect(await donoDoSlug(c, alvo)).toEqual({ salao_id: vencedor.salaoId, atual: true });
        expect(await atuaisDe(c, vencedor.salaoId)).toEqual([alvo]);
        expect(await atuaisDe(c, perdedor.salaoId)).toEqual([perdedor === a ? antesA : antesB]);
        expect((await slugsDe(c, perdedor.salaoId)).map((l) => l.slug)).not.toContain(alvo);
      }
      expect(vencedores.size).toBeGreaterThanOrEqual(1);
    },
    TIMEOUT,
  );

  it(
    'troca cruzada ×10 (A pede o atual de B e B o de A): as duas "em uso", sem impasse; nada muda',
    async () => {
      for (let i = 0; i < VEZES; i += 1) {
        await definirSlugAtual(c, a.salaoId, `cruz-a-${i}`);
        await definirSlugAtual(c, b.salaoId, `cruz-b-${i}`);
        const aAntes = await slugsDe(c, a.salaoId);
        const bAntes = await slugsDe(c, b.salaoId);
        const r = await Promise.all([trocarSlugDoSalao.executar(ga, { slug: `cruz-b-${i}` }), trocarSlugDoSalao.executar(gb, { slug: `cruz-a-${i}` })]);
        expect(r).toEqual([emUso, emUso]);
        expect(await slugsDe(c, a.salaoId)).toEqual(aAntes);
        expect(await slugsDe(c, b.salaoId)).toEqual(bAntes);
      }
    },
    TIMEOUT,
  );
});

describe('CA-13: duas trocas no mesmo salão', () => {
  it(
    'Promise.all ×10 (s1, s2): as duas serializadas, sem 5xx; 1 atual (s1 ou s2); s0 e o outro ficam históricos',
    async () => {
      for (let i = 0; i < VEZES; i += 1) {
        const s0 = `mesmo-s0-${i}`;
        const s1 = `mesmo-s1-${i}`;
        const s2 = `mesmo-s2-${i}`;
        await definirSlugAtual(c, a.salaoId, s0);
        const r = await Promise.all([trocarSlugDoSalao.executar(ga, { slug: s1 }), trocarSlugDoSalao.executar(ga, { slug: s2 })]);
        expect(r).toEqual([trocado(s1), trocado(s2)]);
        const atuais = await atuaisDe(c, a.salaoId);
        expect(atuais).toHaveLength(1);
        expect([s1, s2]).toContain(atuais[0]);
        const perdedor = atuais[0] === s1 ? s2 : s1;
        expect(await donoDoSlug(c, s0)).toEqual({ salao_id: a.salaoId, atual: false });
        expect(await donoDoSlug(c, perdedor)).toEqual({ salao_id: a.salaoId, atual: false });
      }
    },
    TIMEOUT,
  );

  it(
    'regras × slug no mesmo salão ×10: as duas gravam, sem 5xx nem impasse',
    async () => {
      for (let i = 0; i < VEZES; i += 1) {
        const novo = `regras-slug-${i}`;
        const grade = i % 2 === 0 ? '30' : '60';
        const [rr, rs] = await Promise.all([
          salvarConfiguracoes.executar(ga, regras({ nome: `Aurora ${i}`, fuso: MANAUS, grade })),
          trocarSlugDoSalao.executar(ga, { slug: novo }),
        ]);
        expect(rr).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
        expect(rs).toEqual(trocado(novo));
        expect(await linhaSalao(c, a.salaoId)).toMatchObject({ nome: `Aurora ${i}`, grade_min: Number(grade) });
        expect(await atuaisDe(c, a.salaoId)).toEqual([novo]);
      }
    },
    TIMEOUT,
  );

  it(
    'R-2 determinístico: a troca espera a trava de salao; quem a segurava troca o slug por SQL e confirma; a ação vê o atual novo',
    async () => {
      await definirSlugAtual(c, a.salaoId, 'det-s0');
      await trava.query('BEGIN');
      await trava.query('SELECT 1 FROM salao WHERE id = $1 FOR NO KEY UPDATE', [a.salaoId]);
      const acao = trocarSlugDoSalao.executar(ga, { slug: 'det-s2' });
      await aguardarEsperando(1);
      await trava.query('UPDATE salao_slug SET atual = false WHERE salao_id = $1 AND atual', [a.salaoId]);
      await trava.query('INSERT INTO salao_slug (slug, salao_id, atual) VALUES ($1, $2, true)', ['det-s1', a.salaoId]);
      await trava.query('COMMIT');
      expect(await acao).toEqual(trocado('det-s2'));
      expect(await atuaisDe(c, a.salaoId)).toEqual(['det-s2']);
      expect(await donoDoSlug(c, 'det-s0')).toEqual({ salao_id: a.salaoId, atual: false });
      expect(await donoDoSlug(c, 'det-s1')).toEqual({ salao_id: a.salaoId, atual: false });
    },
    TIMEOUT,
  );

  it(
    'R-2 determinístico: com o atual trocado para o pedido enquanto esperava → sem_efeito',
    async () => {
      await definirSlugAtual(c, a.salaoId, 'det2-s0');
      await trava.query('BEGIN');
      await trava.query('SELECT 1 FROM salao WHERE id = $1 FOR NO KEY UPDATE', [a.salaoId]);
      const acao = trocarSlugDoSalao.executar(ga, { slug: 'det2-s1' });
      await aguardarEsperando(1);
      await trava.query('UPDATE salao_slug SET atual = false WHERE salao_id = $1 AND atual', [a.salaoId]);
      await trava.query('INSERT INTO salao_slug (slug, salao_id, atual) VALUES ($1, $2, true)', ['det2-s1', a.salaoId]);
      await trava.query('COMMIT');
      expect(await acao).toEqual({ ok: true, dados: { resultado: 'sem_efeito', slug: 'det2-s1' } });
      expect(await atuaisDe(c, a.salaoId)).toEqual(['det2-s1']);
    },
    TIMEOUT,
  );
});

describe('R-3: a trava de salao não bloqueia reservas nem bloqueios', () => {
  it(
    'com FOR NO KEY UPDATE segurado, um INSERT em bloqueio do mesmo salão (FK → FOR KEY SHARE) conclui sem esperar',
    async () => {
      await trava.query('BEGIN');
      try {
        await trava.query('SELECT 1 FROM salao WHERE id = $1 FOR NO KEY UPDATE', [a.salaoId]);
        await c.query(`SET lock_timeout = '2s'`);
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO bloqueio (salao_id, profissional_id, inicio, fim) VALUES ($1, NULL, '2099-01-10T10:00Z', '2099-01-10T11:00Z') RETURNING id::text AS id`,
          [a.salaoId],
        );
        expect(rows).toHaveLength(1);
        await c.query('DELETE FROM bloqueio WHERE id = $1', [rows[0].id]);
      } finally {
        await c.query('RESET lock_timeout');
        await trava.query('ROLLBACK');
      }
    },
    TIMEOUT,
  );
});
