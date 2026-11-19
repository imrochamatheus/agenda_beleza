import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarDoisSaloes, criarSalaoCompleto, instanteFuturo } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

// CA-3: as fábricas entregam dois salões completos, sem SQL manual no teste. A conferência abaixo é
// independente das fábricas: lê o catálogo por SQL direto (pg) e confere cada elemento e o salão dele.

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
afterAll(async () => {
  await c.end();
});

async function salaoDe(tabela: string, id: string): Promise<string> {
  const r = await c.query<{ salao_id: string }>(`SELECT salao_id FROM ${tabela} WHERE id = $1`, [id]);
  expect(r.rowCount).toBe(1);
  return r.rows[0].salao_id;
}

describe.each([
  ['A', () => a],
  ['B', () => b],
])('CA-3: salão %s completo e pertencente a ele', (_rotulo, salao) => {
  it('CA-3: salão com slug atual (e um histórico)', async () => {
    const s = salao();
    const slugs = await c.query<{ slug: string; atual: boolean }>(
      'SELECT slug, atual FROM salao_slug WHERE salao_id = $1 ORDER BY atual DESC',
      [s.salaoId],
    );
    expect(slugs.rows).toEqual([
      { slug: s.slugAtual, atual: true },
      { slug: s.slugHistorico, atual: false },
    ]);
  });

  it('CA-3: gestor confirmado com perfil de profissional vinculado', async () => {
    const s = salao();
    const u = await c.query(
      'SELECT salao_id, papel, email_confirmado_em IS NOT NULL AS confirmado FROM usuario WHERE id = $1',
      [s.gestor.usuarioId],
    );
    expect(u.rows).toEqual([{ salao_id: s.salaoId, papel: 'gestor', confirmado: true }]);
    const p = await c.query('SELECT id, salao_id, ativo FROM profissional WHERE usuario_id = $1', [s.gestor.usuarioId]);
    expect(p.rows).toEqual([{ id: s.gestor.profissionalId, salao_id: s.salaoId, ativo: true }]);
  });

  it('CA-3: profissional com usuário próprio (papel profissional) e um profissional inativo', async () => {
    const s = salao();
    const u = await c.query('SELECT salao_id, papel FROM usuario WHERE id = $1', [s.profissional.usuarioId]);
    expect(u.rows).toEqual([{ salao_id: s.salaoId, papel: 'profissional' }]);
    const p = await c.query('SELECT id, salao_id, ativo FROM profissional WHERE usuario_id = $1', [
      s.profissional.usuarioId,
    ]);
    expect(p.rows).toEqual([{ id: s.profissional.profissionalId, salao_id: s.salaoId, ativo: true }]);
    const inativo = await c.query('SELECT salao_id, ativo, usuario_id FROM profissional WHERE id = $1', [
      s.profissionalInativoId,
    ]);
    expect(inativo.rows).toEqual([{ salao_id: s.salaoId, ativo: false, usuario_id: null }]);
  });

  it('CA-3: dois serviços ativos e um inativo, com vínculos em servico_profissional', async () => {
    const s = salao();
    const servicos = await c.query<{ id: string; ativo: boolean; salao_id: string }>(
      'SELECT id, ativo, salao_id FROM servico WHERE salao_id = $1 ORDER BY ativo DESC, id',
      [s.salaoId],
    );
    expect(servicos.rows.filter((r) => r.ativo).map((r) => r.id).sort()).toEqual([...s.servicos.ativos].sort());
    expect(servicos.rows.filter((r) => !r.ativo).map((r) => r.id)).toEqual([s.servicos.inativoId]);

    const vinculos = await c.query<{ servico_id: string; profissional_id: string }>(
      'SELECT servico_id, profissional_id FROM servico_profissional WHERE salao_id = $1',
      [s.salaoId],
    );
    for (const servicoId of s.servicos.ativos) {
      expect(vinculos.rows).toContainEqual({ servico_id: servicoId, profissional_id: s.profissional.profissionalId });
      expect(vinculos.rows).toContainEqual({ servico_id: servicoId, profissional_id: s.gestor.profissionalId });
    }
    expect(vinculos.rows).toContainEqual({ servico_id: s.servicos.inativoId, profissional_id: s.profissionalInativoId });
  });

  it('CA-3: jornada semanal e um bloqueio', async () => {
    const s = salao();
    const jornadas = await c.query<{ id: string; salao_id: string; dia_semana: number }>(
      'SELECT id, salao_id, dia_semana FROM jornada WHERE id = ANY($1::uuid[])',
      [s.jornadaIds],
    );
    expect(jornadas.rowCount).toBe(s.jornadaIds.length);
    expect(s.jornadaIds.length).toBeGreaterThanOrEqual(12);
    expect(new Set(jornadas.rows.map((r) => r.salao_id))).toEqual(new Set([s.salaoId]));
    expect(new Set(jornadas.rows.map((r) => r.dia_semana))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(await salaoDe('bloqueio', s.bloqueioId)).toBe(s.salaoId);
  });

  it('CA-3: uma cliente ativa e uma anonimizada', async () => {
    const s = salao();
    const ativa = await c.query('SELECT salao_id, nome, telefone_e164, anonimizada_em FROM cliente WHERE id = $1', [
      s.clientes.ativaId,
    ]);
    expect(ativa.rows).toEqual([
      { salao_id: s.salaoId, nome: s.clientes.nomeAtiva, telefone_e164: s.clientes.telefoneAtiva, anonimizada_em: null },
    ]);
    const anon = await c.query(
      'SELECT salao_id, nome, telefone_e164, anonimizada_em IS NOT NULL AS anonimizada FROM cliente WHERE id = $1',
      [s.clientes.anonimizadaId],
    );
    expect(anon.rows).toEqual([{ salao_id: s.salaoId, nome: null, telefone_e164: null, anonimizada: true }]);
  });

  it('CA-3: reserva confirmada, no futuro, com itens em snapshot de preço e duração', async () => {
    const s = salao();
    const r = await c.query<{ salao_id: string; status: string; inicio: Date; fim: Date; profissional_id: string; cliente_id: string }>(
      'SELECT salao_id, status, inicio, fim, profissional_id, cliente_id FROM reserva WHERE id = $1',
      [s.reserva.id],
    );
    expect(r.rows).toEqual([
      {
        salao_id: s.salaoId,
        status: 'confirmado',
        inicio: s.reserva.inicio,
        fim: s.reserva.fim,
        profissional_id: s.profissional.profissionalId,
        cliente_id: s.clientes.ativaId,
      },
    ]);
    expect(r.rows[0].inicio.getTime()).toBeGreaterThan(Date.now());

    const itens = await c.query(
      `SELECT i.id, i.salao_id, i.servico_id, i.ordem, i.preco_centavos, i.duracao_min,
              s.preco_centavos AS preco_atual, s.duracao_min AS duracao_atual
         FROM reserva_item i JOIN servico s ON s.salao_id = i.salao_id AND s.id = i.servico_id
        WHERE i.salao_id = $1 AND i.reserva_id = $2 ORDER BY i.ordem`,
      [s.salaoId, s.reserva.id],
    );
    expect(itens.rows.map((i) => i.id)).toEqual(s.reserva.itemIds);
    expect(itens.rows.map((i) => i.servico_id)).toEqual(s.servicos.ativos);
    for (const i of itens.rows) {
      expect(i.salao_id).toBe(s.salaoId);
      expect([i.preco_centavos, i.duracao_min]).toEqual([i.preco_atual, i.duracao_atual]);
    }
    const duracaoTotal = itens.rows.reduce((t, i) => t + i.duracao_min, 0);
    expect(s.reserva.fim.getTime() - s.reserva.inicio.getTime()).toBe(duracaoTotal * 60_000);
  });
});

describe('CA-3: os dois salões são distintos e as fábricas aceitam sobrescritas', () => {
  it('CA-3: A e B não compartilham nenhum ID, slug, e-mail nem telefone', () => {
    const valores = (s: SalaoCompleto) =>
      new Set([
        s.salaoId,
        s.slugAtual,
        s.slugHistorico,
        s.gestor.usuarioId,
        s.gestor.email,
        s.profissional.usuarioId,
        s.profissional.email,
        s.profissional.profissionalId,
        s.profissionalInativoId,
        ...s.servicos.ativos,
        s.servicos.inativoId,
        s.clientes.ativaId,
        s.clientes.anonimizadaId,
        s.clientes.telefoneAtiva,
        s.reserva.id,
      ]);
    const doA = valores(a);
    expect([...valores(b)].filter((v) => doA.has(v))).toEqual([]);
  });

  it('CA-3: sobrescritas de campos são aplicadas e o gestor pode ficar sem perfil', async () => {
    const inicio = instanteFuturo(20, 10, 30);
    const s = await criarSalaoCompleto({
      salao: { nome: 'Salão Sobrescrito', fuso: 'America/Manaus', gradeMin: 30, intervaloMin: 10 },
      slugAtual: 'salao-sobrescrito-x1',
      gestor: { nome: 'Gestora Sem Perfil', comPerfil: false },
      profissional: { nome: 'Joana' },
      servicos: { ativos: [{ nome: 'Manicure', precoCentavos: 3500, duracaoMin: 45 }], inativo: { nome: 'Antigo' } },
      cliente: { nome: 'Maria', telefoneE164: '+5521987654321' },
      reserva: { inicio },
    });
    const salao = await c.query('SELECT nome, fuso, grade_min, intervalo_min FROM salao WHERE id = $1', [s.salaoId]);
    expect(salao.rows).toEqual([{ nome: 'Salão Sobrescrito', fuso: 'America/Manaus', grade_min: 30, intervalo_min: 10 }]);
    expect(s.slugAtual).toBe('salao-sobrescrito-x1');
    expect(s.slugHistorico).toBe('salao-sobrescrito-x1-antigo');
    expect(s.gestor.profissionalId).toBeNull();
    const perfis = await c.query('SELECT 1 FROM profissional WHERE usuario_id = $1', [s.gestor.usuarioId]);
    expect(perfis.rowCount).toBe(0);
    expect(s.servicos.nomes).toEqual(['Manicure', 'Escova', 'Antigo']);
    const servico = await c.query('SELECT nome, preco_centavos, duracao_min FROM servico WHERE id = $1', [s.servicos.ativos[0]]);
    expect(servico.rows).toEqual([{ nome: 'Manicure', preco_centavos: 3500, duracao_min: 45 }]);
    expect(s.clientes).toMatchObject({ nomeAtiva: 'Maria', telefoneAtiva: '+5521987654321' });
    expect(s.reserva.inicio).toEqual(inicio);
    // 45 + 30 min (Manicure + Escova padrão).
    expect(s.reserva.fim.getTime() - inicio.getTime()).toBe(75 * 60_000);
  });

  it('CA-3: o teste de isolamento usa só as fábricas (sem INSERT nem SQL bruto do Prisma)', () => {
    const fonte = readFileSync(fileURLToPath(new URL('./isolamento.test.ts', import.meta.url)), 'utf8');
    expect(fonte).toMatch(/criarDoisSaloes/);
    expect(fonte).not.toMatch(/INSERT|\$executeRaw|\$queryRaw/i);
  });
});
