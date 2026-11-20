import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { lerPerfilPublico } from '@/server/repos/publico';
import { salvarConfiguracoes, trocarSlugDoSalao } from '@/server/salao/configuracoes.acao';
import { salvarFuncionamentoDoSalao } from '@/server/salao/funcionamento.acao';
import { salvarPerfilDoSalao } from '@/server/salao/perfil.acao';
import { criarPublicoContext } from '@/server/tenant/context';
import type { Credencial } from '@/server/tenant/sessao';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { MANAUS, atuaisDe, regras } from './apoio';
import { SEG_A_SAB, credGestor, funcionamento, linhaSalao, perfilCompleto, semanaDe } from './apoio-perfil';

// D-020 T-11: concorrência com PostgreSQL real. CA-4 (duas semanas em paralelo), CA-12 (perfil ×
// funcionamento, perfil × regras, funcionamento × slug, perfil × perfil), R-3 (leitura pública nunca vê
// estado misto) e R-5 (a trava do salão não bloqueia a criação de bloqueio; a gravação espera a trava).
// Cada caso ×10. Nenhuma resposta pode ser exceção (5xx), `deadlock detected` ou 23P01 vazado: toda
// resposta tem de ser { ok: true }. Timeout explícito por `it`.

const TIMEOUT = 60_000;
const VEZES = 10;
const MARCADOR = 'FOR NO KEY UPDATE';

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

const SEMANA_A = funcionamento('informar', SEG_A_SAB);
const SEMANA_B = funcionamento('informar', { 0: [['10:00', '14:00']], 3: [['08:00', '12:00'], ['13:00', '22:00']], 5: [['22:00', '24:00']] });
const LINHAS_A: [number, number, number][] = [1, 2, 3, 4, 5, 6].map((d) => [d, 540, 1080]);
const LINHAS_B: [number, number, number][] = [
  [0, 600, 840],
  [3, 480, 720],
  [3, 780, 1320],
  [5, 1320, 1440],
];
const salvo = { ok: true, dados: { resultado: 'salvo' } };

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

describe('CA-4: duas semanas diferentes do mesmo salão em paralelo', () => {
  it(
    'Promise.all ×10: as duas salvas, sem 5xx/impasse/23P01; a semana final é exatamente uma das duas',
    async () => {
      const finais = new Set<string>();
      for (let i = 0; i < VEZES; i += 1) {
        const [ra, rb] = await Promise.all([salvarFuncionamentoDoSalao.executar(g, SEMANA_A), salvarFuncionamentoDoSalao.executar(g, SEMANA_B)]);
        expect(ra).toMatchObject(salvo);
        expect(rb).toMatchObject(salvo);
        const final = await semanaDe(c, s.salaoId);
        expect([JSON.stringify(LINHAS_A), JSON.stringify(LINHAS_B)]).toContain(JSON.stringify(final));
        finais.add(JSON.stringify(final));
        expect((await linhaSalao(c, s.salaoId)).funcionamento_definido).toBe(true);
      }
      expect(finais.size).toBeGreaterThanOrEqual(1);
    },
    TIMEOUT,
  );
});

describe('CA-12: gravações de formulários diferentes do mesmo salão', () => {
  it(
    '(a) perfil × funcionamento ×10: as duas aparecem no estado final',
    async () => {
      for (let i = 0; i < VEZES; i += 1) {
        const instagram = `perfil.a${i}`;
        const semana = i % 2 === 0 ? SEMANA_A : SEMANA_B;
        const [rp, rf] = await Promise.all([
          salvarPerfilDoSalao.executar(g, perfilCompleto({ instagram })),
          salvarFuncionamentoDoSalao.executar(g, semana),
        ]);
        expect(rp).toMatchObject(salvo);
        expect(rf).toMatchObject(salvo);
        expect((await linhaSalao(c, s.salaoId)).instagram).toBe(instagram);
        expect(await semanaDe(c, s.salaoId)).toEqual(i % 2 === 0 ? LINHAS_A : LINHAS_B);
      }
    },
    TIMEOUT,
  );

  it(
    '(b) perfil × regras (D-017) ×10: nenhuma sobrescreve as colunas da outra',
    async () => {
      for (let i = 0; i < VEZES; i += 1) {
        const instagram = `perfil.b${i}`;
        const grade = i % 2 === 0 ? '30' : '60';
        const [rp, rr] = await Promise.all([
          salvarPerfilDoSalao.executar(g, perfilCompleto({ instagram })),
          salvarConfiguracoes.executar(g, regras({ nome: `Studio ${i}`, fuso: MANAUS, grade })),
        ]);
        expect(rp).toMatchObject(salvo);
        expect(rr).toMatchObject(salvo);
        expect(await linhaSalao(c, s.salaoId)).toMatchObject({ instagram, nome: `Studio ${i}`, grade_min: Number(grade), fuso: MANAUS });
      }
    },
    TIMEOUT,
  );

  it(
    '(c) funcionamento × troca de slug (D-017) ×10: as duas gravam',
    async () => {
      for (let i = 0; i < VEZES; i += 1) {
        const novo = `func-slug-${i}-${s.salaoId.slice(0, 8)}`;
        const [rf, rs] = await Promise.all([
          salvarFuncionamentoDoSalao.executar(g, i % 2 === 0 ? SEMANA_B : funcionamento('nao_informar')),
          trocarSlugDoSalao.executar(g, { slug: novo }),
        ]);
        expect(rf).toMatchObject(salvo);
        expect(rs).toEqual({ ok: true, dados: { resultado: 'trocado', slug: novo } });
        expect(await atuaisDe(c, s.salaoId)).toEqual([novo]);
        expect(await semanaDe(c, s.salaoId)).toEqual(i % 2 === 0 ? LINHAS_B : []);
        expect((await linhaSalao(c, s.salaoId)).funcionamento_definido).toBe(i % 2 === 0);
      }
    },
    TIMEOUT,
  );

  it(
    'perfil × perfil ×10: o estado final é exatamente um dos dois',
    async () => {
      for (let i = 0; i < VEZES; i += 1) {
        const um = perfilCompleto({ instagram: `um.${i}`, telefone: '(11) 3456-7890', meiosPagamento: ['pix'] });
        const dois = perfilCompleto({ instagram: `dois.${i}`, telefone: '(21) 98765-4321', meiosPagamento: ['dinheiro'], cep: '20040-002', uf: 'RJ', cidade: 'Rio de Janeiro' });
        const r = await Promise.all([salvarPerfilDoSalao.executar(g, um), salvarPerfilDoSalao.executar(g, dois)]);
        expect(r[0]).toMatchObject(salvo);
        expect(r[1]).toMatchObject(salvo);
        const l = await linhaSalao(c, s.salaoId);
        const final = [l.instagram, l.telefone_e164, l.meios_pagamento, l.endereco_cep, l.endereco_uf];
        expect([
          JSON.stringify([`um.${i}`, '+551134567890', ['pix'], '01310100', 'SP']),
          JSON.stringify([`dois.${i}`, '+5521987654321', ['dinheiro'], '20040002', 'RJ']),
        ]).toContain(JSON.stringify(final));
      }
    },
    TIMEOUT,
  );
});

describe('R-3: leitura pública consistente', () => {
  it(
    'informar/não informar em paralelo com leituras ×10: nunca { definido: true } com 7 dias vazios',
    async () => {
      const ctx = criarPublicoContext(s.salaoId, 'x');
      for (let i = 0; i < VEZES; i += 1) {
        const leituras = Array.from({ length: 6 }, () => lerPerfilPublico(ctx));
        const [r1, r2, ...lidos] = await Promise.all([
          salvarFuncionamentoDoSalao.executar(g, SEMANA_A),
          salvarFuncionamentoDoSalao.executar(g, funcionamento('nao_informar')),
          ...leituras,
        ]);
        expect(r1).toMatchObject(salvo);
        expect(r2).toMatchObject(salvo);
        for (const p of lidos as Awaited<ReturnType<typeof lerPerfilPublico>>[]) {
          if (p.funcionamento !== null) {
            expect(p.funcionamento.some((d) => d.intervalos.length > 0)).toBe(true);
            expect(p.funcionamento.flatMap((d) => d.intervalos.map((x) => [d.diaSemana, x.inicioMin, x.fimMin]))).toEqual(LINHAS_A);
          }
        }
      }
    },
    TIMEOUT,
  );
});

describe('R-5: trava do salão × bloqueios e gravações', () => {
  it(
    'com FOR NO KEY UPDATE segurado: a gravação do funcionamento espera; um bloqueio do salão é criado sem esperar; ao liberar, a gravação conclui',
    async () => {
      await salvarFuncionamentoDoSalao.executar(g, funcionamento('nao_informar'));
      await trava.query('BEGIN');
      let acao: Promise<unknown> | undefined;
      try {
        await trava.query('SELECT 1 FROM salao WHERE id = $1 FOR NO KEY UPDATE', [s.salaoId]);
        acao = salvarFuncionamentoDoSalao.executar(g, SEMANA_B);
        await aguardarEsperando(1);
        await c.query(`SET lock_timeout = '2s'`);
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO bloqueio (salao_id, profissional_id, inicio, fim) VALUES ($1, NULL, '2099-02-10T10:00Z', '2099-02-10T11:00Z') RETURNING id::text AS id`,
          [s.salaoId],
        );
        expect(rows).toHaveLength(1);
        await c.query('DELETE FROM bloqueio WHERE id = $1', [rows[0].id]);
        expect(await semanaDe(c, s.salaoId)).toEqual([]);
      } finally {
        await c.query('RESET lock_timeout');
        await trava.query('COMMIT');
      }
      expect(await acao).toMatchObject(salvo);
      expect(await semanaDe(c, s.salaoId)).toEqual(LINHAS_B);
    },
    TIMEOUT,
  );

  it(
    'perfil (UPDATE) também espera a trava do salão e conclui depois, sem impasse',
    async () => {
      await trava.query('BEGIN');
      let acao: Promise<unknown> | undefined;
      try {
        await trava.query('SELECT 1 FROM salao WHERE id = $1 FOR NO KEY UPDATE', [s.salaoId]);
        acao = salvarPerfilDoSalao.executar(g, perfilCompleto({ instagram: 'esperou.a.trava' }));
        const limite = Date.now() + 10_000;
        for (;;) {
          const { rows } = await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'UPDATE%salao%'`,
          );
          if (rows[0].n > 0) break;
          if (Date.now() > limite) throw new Error('o UPDATE do perfil não esperou a trava');
          await new Promise((r) => setTimeout(r, 20));
        }
        expect((await linhaSalao(c, s.salaoId)).instagram).not.toBe('esperou.a.trava');
      } finally {
        await trava.query('COMMIT');
      }
      expect(await acao).toMatchObject(salvo);
      expect((await linhaSalao(c, s.salaoId)).instagram).toBe('esperou.a.trava');
    },
    TIMEOUT,
  );
});
