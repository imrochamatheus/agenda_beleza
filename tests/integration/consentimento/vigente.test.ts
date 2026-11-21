import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { consentimentoVigente } from '@/server/consentimento/leitura';

import { criarConsentimento, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { ctxPublico, inserirCliente } from './apoio';

// D-023 T-5: CA-14 (RN-14). Vigente = a mais recente, com desempate por id.

let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const t = (min: number) => new Date(Date.UTC(2026, 10, 21, 12, min));

describe('CA-14: consentimento vigente', () => {
  it('devolve a linha mais recente; finalidades não se misturam; sem linha → null', async () => {
    const id = await inserirCliente(c, s.salaoId, 'Varias');
    await criarConsentimento(s.salaoId, id, { versaoTermos: 'v-a', criadoEm: t(0) });
    const nova = await criarConsentimento(s.salaoId, id, { versaoTermos: 'v-c', criadoEm: t(20) });
    await criarConsentimento(s.salaoId, id, { versaoTermos: 'v-b', criadoEm: t(10) });
    await criarConsentimento(s.salaoId, id, { finalidade: 'convite_avaliacao', versaoTermos: 'v-convite', criadoEm: t(30) });
    expect(await consentimentoVigente(ctxPublico(s), id, 'mensagens_reserva')).toMatchObject({ id: nova.id, versaoTermos: 'v-c', criadoEm: t(20) });
    expect(await consentimentoVigente(ctxPublico(s), id, 'convite_avaliacao')).toMatchObject({ versaoTermos: 'v-convite', finalidade: 'convite_avaliacao' });
    expect(await consentimentoVigente(ctxPublico(s), id, 'publicacao_avaliacao')).toBeNull();
  });

  it('empate de criado_em: desempate determinístico por id decrescente', async () => {
    const id = await inserirCliente(c, s.salaoId, 'Empate');
    const x = await criarConsentimento(s.salaoId, id, { versaoTermos: 'v-x', criadoEm: t(5) });
    const y = await criarConsentimento(s.salaoId, id, { versaoTermos: 'v-y', criadoEm: t(5) });
    const maior = x.id > y.id ? x : y;
    for (let i = 0; i < 3; i += 1) {
      expect((await consentimentoVigente(ctxPublico(s), id, 'mensagens_reserva'))?.id).toBe(maior.id);
    }
  });

  it('cliente sem linha → null', async () => {
    const id = await inserirCliente(c, s.salaoId, 'Sem Aceite');
    expect(await consentimentoVigente(ctxPublico(s), id, 'mensagens_reserva')).toBeNull();
  });
});

describe('plano da consulta de vigente (A-8, DBA)', () => {
  it('com volume, usa o índice consentimento_vigente_idx e não varre a tabela', async () => {
    await c.query(
      `INSERT INTO cliente (salao_id, nome, telefone_e164)
       SELECT $1, 'Volume ' || g, '+5511' || (800000000 + g)::text FROM generate_series(1, 200) g`,
      [s.salaoId],
    );
    await c.query(
      `INSERT INTO consentimento (salao_id, cliente_id, finalidade, origem, versao_termos, criado_em)
       SELECT $1, k.id, 'mensagens_reserva', 'publico', 'v-volume', now() - (g || ' minutes')::interval
         FROM cliente k, generate_series(1, 25) g WHERE k.salao_id = $1 AND k.nome LIKE 'Volume %'`,
      [s.salaoId],
    );
    await c.query('ANALYZE consentimento');
    const { rows: alvo } = await c.query<{ id: string }>("SELECT id::text FROM cliente WHERE salao_id = $1 AND nome = 'Volume 7'", [s.salaoId]);
    const { rows } = await c.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT id FROM consentimento k
        WHERE k.salao_id = $1 AND k.cliente_id = $2 AND k.finalidade = 'mensagens_reserva'
        ORDER BY k.criado_em DESC, k.id DESC LIMIT 1`,
      [s.salaoId, alvo[0].id],
    );
    const plano = rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(plano).toContain('consentimento_vigente_idx');
    expect(plano).not.toContain('Seq Scan on consentimento');
    expect(plano).not.toContain('Sort');
  });
});
