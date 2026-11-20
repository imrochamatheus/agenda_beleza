import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { salvarConfiguracoes, trocarSlugDoSalao } from '@/server/salao/configuracoes.acao';
import { MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';
import type { Credencial } from '@/server/tenant/sessao';

import { criarDoisSaloes, instanteFuturo } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, inserirReserva } from '../../support/sql';

import { atuaisDe, credGestor, donoDoSlug, linhaSalao, regras, slugsDe } from './apoio';

// D-017 T-11 (tester): regressão independente, contra PostgreSQL real e dois salões. Cobre pontos não
// exercitados literalmente pelos testes do desenvolvedor: D-17 (Asia/Katmandu × Asia/Kathmandu) pela
// ação, fuso fora da lista só enquanto for o atual, bordas da coerência antecedência × janela, tipos
// errados, slug de 60/61 caracteres e reservados com caixa/espaços, mesma troca em paralelo no mesmo
// salão, INSERT pendente de outra transação (commit e rollback) e travas compatíveis com reserva/bloqueio.

const TIMEOUT = 30_000;

let c: pg.Client;
let outra: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;
let ga: Credencial;
let gb: Credencial;

beforeAll(async () => {
  c = await conectar();
  outra = await conectar();
  ({ a, b } = await criarDoisSaloes());
  ga = await credGestor(a);
  gb = await credGestor(b);
});
afterAll(async () => {
  await outra.end();
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const salvo = { ok: true, dados: { resultado: 'salvo' } };
const invalido = (erros: Record<string, string>) => ({ ok: true, dados: { resultado: 'invalido', erros } });
const trocado = (slug: string) => ({ ok: true, dados: { resultado: 'trocado', slug } });
const recusaSlug = (msg: string) => ({ ok: true, dados: { resultado: 'invalido', erros: { slug: msg } } });

async function fusoDe(salaoId: string): Promise<string> {
  return (await c.query<{ fuso: string }>('SELECT fuso FROM salao WHERE id = $1', [salaoId])).rows[0].fuso;
}

/** Corre `p` contra um limite: 'pendente' se não terminar em `ms`. */
async function emAte<T>(p: Promise<T>, ms: number): Promise<T | 'pendente'> {
  return Promise.race([p, new Promise<'pendente'>((r) => setTimeout(() => r('pendente'), ms))]);
}

describe('fuso (RN-9, D-17)', () => {
  it('Asia/Katmandu (canônico no ICU do Node 24) é gravado; Asia/Kathmandu é recusado sem gravar', async () => {
    expect(Intl.supportedValuesOf('timeZone')).toContain('Asia/Katmandu');
    expect(await salvarConfiguracoes.executar(ga, regras({ fuso: 'Asia/Katmandu' }))).toMatchObject(salvo);
    expect(await fusoDe(a.salaoId)).toBe('Asia/Katmandu');
    const antes = await linhaSalao(c, a.salaoId);
    expect(await salvarConfiguracoes.executar(ga, regras({ fuso: 'Asia/Kathmandu' }))).toEqual(invalido({ fuso: M.fuso }));
    expect(await linhaSalao(c, a.salaoId)).toEqual(antes);
  });

  it('valor gravado fora da lista é aceito só enquanto for o atual', async () => {
    await c.query(`UPDATE salao SET fuso = 'Brazil/East' WHERE id = $1`, [a.salaoId]);
    expect(await salvarConfiguracoes.executar(ga, regras({ fuso: 'Brazil/East' }))).toMatchObject(salvo);
    expect(await fusoDe(a.salaoId)).toBe('Brazil/East');
    // Outro alias, mesmo válido no Intl, é recusado.
    expect(await salvarConfiguracoes.executar(ga, regras({ fuso: 'US/Eastern' }))).toEqual(invalido({ fuso: M.fuso }));
    // O alias atual de A não vale para B.
    expect(await salvarConfiguracoes.executar(gb, regras({ fuso: 'Brazil/East' }))).toEqual(invalido({ fuso: M.fuso }));
    // Depois de trocar para um canônico, o alias deixa de ser aceito.
    expect(await salvarConfiguracoes.executar(ga, regras({ fuso: 'America/Manaus' }))).toMatchObject(salvo);
    expect(await salvarConfiguracoes.executar(ga, regras({ fuso: 'Brazil/East' }))).toEqual(invalido({ fuso: M.fuso }));
    expect(await fusoDe(a.salaoId)).toBe('America/Manaus');
  });
});

describe('regras: bordas e tipos (RN-10, RN-18)', () => {
  it('coerência antecedência < janela × 24 nas bordas', async () => {
    expect(await salvarConfiguracoes.executar(ga, regras({ janela: '1', antecedencia: '24' }))).toEqual(
      invalido({ antecedencia: M.antecedenciaJanela }),
    );
    expect(await salvarConfiguracoes.executar(ga, regras({ janela: '1', antecedencia: '23' }))).toMatchObject(salvo);
    expect(await salvarConfiguracoes.executar(ga, regras({ janela: '3', antecedencia: '72' }))).toEqual(
      invalido({ antecedencia: M.antecedenciaJanela }),
    );
    expect(await salvarConfiguracoes.executar(ga, regras({ janela: '4', antecedencia: '72' }))).toMatchObject(salvo);
    const { rows } = await c.query('SELECT antecedencia_min, janela_dias FROM salao WHERE id = $1', [a.salaoId]);
    expect(rows[0]).toEqual({ antecedencia_min: 4320, janela_dias: 4 });
  });

  it('número em vez de texto, dígitos não ASCII, hexadecimal e null são recusados sem 5xx; espaços nas pontas aceitos', async () => {
    const antes = await linhaSalao(c, a.salaoId);
    expect(await salvarConfiguracoes.executar(ga, regras({ grade: 30 }))).toEqual(invalido({ grade: M.grade }));
    expect(await salvarConfiguracoes.executar(ga, regras({ grade: '３０' }))).toEqual(invalido({ grade: M.grade }));
    expect(await salvarConfiguracoes.executar(ga, regras({ intervalo: '0x1E' }))).toEqual(invalido({ intervalo: M.intervalo }));
    expect(await salvarConfiguracoes.executar(ga, regras({ janela: null, nome: ['x', 'y'] }))).toEqual(
      invalido({ janela: M.janela, nome: M.nome }),
    );
    expect(await linhaSalao(c, a.salaoId)).toEqual(antes);
    expect(await salvarConfiguracoes.executar(ga, regras({ grade: ' 30 ', intervalo: ' 120 ' }))).toMatchObject(salvo);
    const { rows } = await c.query('SELECT grade_min, intervalo_min FROM salao WHERE id = $1', [a.salaoId]);
    expect(rows[0]).toEqual({ grade_min: 30, intervalo_min: 120 });
  });

  it('salaoId/salao_id/id de B forjados nas duas ações: só A muda', async () => {
    const bAntes = await linhaSalao(c, b.salaoId);
    const bSlugs = await slugsDe(c, b.salaoId);
    const forja: Record<string, unknown> = { salaoId: b.salaoId, salao_id: b.salaoId, id: b.salaoId };
    expect(await salvarConfiguracoes.executar(ga, { ...regras({ nome: 'Forjado A' }), ...forja })).toMatchObject(salvo);
    expect(await trocarSlugDoSalao.executar(ga, { slug: 'forjado-a', ...forja })).toEqual(trocado('forjado-a'));
    expect(await linhaSalao(c, b.salaoId)).toEqual(bAntes);
    expect(await slugsDe(c, b.salaoId)).toEqual(bSlugs);
    expect(await donoDoSlug(c, 'forjado-a')).toEqual({ salao_id: a.salaoId, atual: true });
  });
});

describe('slug: tamanho e reservados (RN-12, RN-13)', () => {
  it('60 caracteres aceito; 61 recusado; reservado com caixa e espaços recusado como reservado', async () => {
    const s60 = `t${'a'.repeat(59)}`;
    expect(s60).toHaveLength(60);
    const antes = await slugsDe(c, a.salaoId);
    expect(await trocarSlugDoSalao.executar(ga, { slug: `${s60}b` })).toEqual(recusaSlug(M.slugFormato));
    for (const r of [' PAINEL ', 'Admin', 'api', 'entrar']) {
      expect(await trocarSlugDoSalao.executar(ga, { slug: r }), r).toEqual(recusaSlug(M.slugReservado));
    }
    expect(await trocarSlugDoSalao.executar(ga, { slug: '_next' })).toEqual(recusaSlug(M.slugFormato));
    expect(await slugsDe(c, a.salaoId)).toEqual(antes);
    expect(await trocarSlugDoSalao.executar(ga, { slug: s60.toUpperCase() })).toEqual(trocado(s60));
    expect(await atuaisDe(c, a.salaoId)).toEqual([s60]);
  });
});

describe('concorrência e travas (RN-15, R-3)', () => {
  it(
    'o mesmo slug novo pedido duas vezes em paralelo no mesmo salão: um trocado e um sem efeito (×10)',
    async () => {
      for (let i = 0; i < 10; i += 1) {
        const alvo = `duplo-envio-${i}`;
        const rs = await Promise.all([trocarSlugDoSalao.executar(ga, { slug: alvo }), trocarSlugDoSalao.executar(ga, { slug: alvo })]);
        const tipos = rs.map((r) => (r.ok ? r.dados.resultado : r.erro)).sort();
        expect(tipos, `iteração ${i}`).toEqual(['sem_efeito', 'trocado']);
        expect(await atuaisDe(c, a.salaoId)).toEqual([alvo]);
      }
    },
    TIMEOUT,
  );

  it(
    'INSERT pendente do mesmo slug por outra transação: espera; commit → "em uso"; rollback → trocado',
    async () => {
      const aAntes = await slugsDe(c, a.salaoId);
      await outra.query('BEGIN');
      await outra.query(`INSERT INTO salao_slug (slug, salao_id, atual) VALUES ('pendente-um', $1, false)`, [b.salaoId]);
      const p1 = trocarSlugDoSalao.executar(ga, { slug: 'pendente-um' });
      expect(await emAte(p1, 500)).toBe('pendente');
      await outra.query('COMMIT');
      expect(await p1).toEqual(recusaSlug(M.slugEmUso));
      expect(await slugsDe(c, a.salaoId)).toEqual(aAntes);

      await outra.query('BEGIN');
      await outra.query(`INSERT INTO salao_slug (slug, salao_id, atual) VALUES ('pendente-dois', $1, false)`, [b.salaoId]);
      const p2 = trocarSlugDoSalao.executar(ga, { slug: 'pendente-dois' });
      expect(await emAte(p2, 500)).toBe('pendente');
      await outra.query('ROLLBACK');
      expect(await p2).toEqual(trocado('pendente-dois'));
      expect(await donoDoSlug(c, 'pendente-dois')).toEqual({ salao_id: a.salaoId, atual: true });
    },
    TIMEOUT,
  );

  it(
    'INSERT de reserva pendente (FOR KEY SHARE em salao) não bloqueia a troca de slug nem as regras; a trava do salão não bloqueia INSERT de reserva',
    async () => {
      await outra.query('BEGIN');
      await inserirReserva(outra, {
        salaoId: a.salaoId,
        profissionalId: a.profissional.profissionalId,
        clienteId: a.clientes.ativaId,
        inicio: instanteFuturo(40, 13).toISOString(),
        fim: instanteFuturo(40, 14).toISOString(),
      });
      expect(await emAte(trocarSlugDoSalao.executar(ga, { slug: 'sem-espera-reserva' }), 3000)).toEqual(trocado('sem-espera-reserva'));
      expect(await emAte(salvarConfiguracoes.executar(ga, regras({ nome: 'Sem espera' })), 3000)).toMatchObject(salvo);
      await outra.query('ROLLBACK');

      // Inverso: a trava FOR NO KEY UPDATE segurada não impede o INSERT de reserva (FK para salao).
      await outra.query('BEGIN');
      await outra.query('SELECT 1 FROM salao WHERE id = $1 FOR NO KEY UPDATE', [a.salaoId]);
      await c.query('BEGIN');
      await c.query(`SET LOCAL lock_timeout = '2s'`);
      await inserirReserva(c, {
        salaoId: a.salaoId,
        profissionalId: a.profissional.profissionalId,
        clienteId: a.clientes.ativaId,
        inicio: instanteFuturo(41, 13).toISOString(),
        fim: instanteFuturo(41, 14).toISOString(),
      });
      await c.query('ROLLBACK');
      // E a troca de slug espera essa trava (serialização por salão).
      const p = trocarSlugDoSalao.executar(ga, { slug: 'apos-trava' });
      expect(await emAte(p, 500)).toBe('pendente');
      await outra.query('COMMIT');
      expect(await p).toEqual(trocado('apos-trava'));
    },
    TIMEOUT,
  );
});
