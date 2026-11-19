import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';
import { resolverTenant } from '@/server/tenant/sessao';

import { credencialDoGestor } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

// CA-14: unidade de trabalho. Uma alteração por um repositório seguida de falha em outro repositório
// desfaz tudo; sem falha, as duas persistem. Conferência por SQL direto, fora da transação.

let c: pg.Client;
let s: SalaoCompleto;
let ctx: TenantContext;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
  ctx = await resolverTenant(await credencialDoGestor(s));
});
afterAll(async () => {
  await c.end();
});

async function estado(): Promise<{ servico: unknown; cliente: unknown; reserva: unknown }> {
  // Em sequência: um pg.Client não aceita consultas simultâneas.
  const servico = await c.query('SELECT to_jsonb(t) AS l FROM servico t WHERE id = $1', [s.servicos.ativos[0]]);
  const cliente = await c.query('SELECT to_jsonb(t) AS l FROM cliente t WHERE id = $1', [s.clientes.ativaId]);
  const reserva = await c.query('SELECT to_jsonb(t) AS l FROM reserva t WHERE id = $1', [s.reserva.id]);
  return { servico: servico.rows[0].l, cliente: cliente.rows[0].l, reserva: reserva.rows[0].l };
}

describe('CA-14: emTransacao', () => {
  it('CA-14: falha (erro lançado) depois de alterar por um repositório desfaz tudo', async () => {
    const antes = await estado();
    const erro = new Error('falha proposital');
    await expect(
      emTransacao(async (r) => {
        await r.servicos.renomear(ctx, s.servicos.ativos[0], 'Desfeito');
        await r.clientes.renomear(ctx, s.clientes.ativaId, 'Desfeita');
        // Dentro da transação a alteração é visível...
        expect((await r.servicos.buscarPorId(ctx, s.servicos.ativos[0])).nome).toBe('Desfeito');
        throw erro;
      }),
    ).rejects.toBe(erro);
    expect(await estado()).toEqual(antes);
  });

  it('CA-14: NaoEncontrado numa operação de outro repositório desfaz a alteração anterior', async () => {
    const antes = await estado();
    await expect(
      emTransacao(async (r) => {
        await r.servicos.renomear(ctx, s.servicos.ativos[0], 'Desfeito 2');
        // Cliente anonimizada: o predicado do repositório de clientes recusa → NaoEncontrado.
        await r.clientes.renomear(ctx, s.clientes.anonimizadaId, 'Não pode');
      }),
    ).rejects.toBeInstanceOf(NaoEncontrado);
    expect(await estado()).toEqual(antes);
  });

  it('CA-14: sem falha, as alterações de repositórios diferentes persistem juntas', async () => {
    const resultado = await emTransacao(async (r) => {
      const servico = await r.servicos.renomear(ctx, s.servicos.ativos[0], 'Corte confirmado');
      const profissional = await r.profissionais.renomear(ctx, s.profissional.profissionalId, 'Ana Confirmada');
      const reserva = await r.reservas.atualizarStatus(ctx, s.reserva.id, { de: 'confirmado', para: 'concluido' });
      return { servico: servico.nome, profissional: profissional.nome, reserva: reserva.status };
    });
    expect(resultado).toEqual({ servico: 'Corte confirmado', profissional: 'Ana Confirmada', reserva: 'concluido' });
    const depois = await estado();
    expect((depois.servico as { nome: string }).nome).toBe('Corte confirmado');
    expect((depois.reserva as { status: string }).status).toBe('concluido');
    const p = await c.query('SELECT nome FROM profissional WHERE id = $1', [s.profissional.profissionalId]);
    expect(p.rows).toEqual([{ nome: 'Ana Confirmada' }]);
  });

  it('CA-14: a transação usa READ COMMITTED', async () => {
    // Leitura pelo próprio executor da transação não é exposta; confere-se o efeito: uma alteração
    // confirmada fora dela, antes da 2ª leitura, é vista dentro (não seria em REPEATABLE READ).
    const nomes = await emTransacao(async (r) => {
      const primeiro = (await r.servicos.buscarPorId(ctx, s.servicos.ativos[1])).nome;
      await c.query('UPDATE servico SET nome = $1 WHERE id = $2', ['Alterado fora', s.servicos.ativos[1]]);
      const segundo = (await r.servicos.buscarPorId(ctx, s.servicos.ativos[1])).nome;
      return [primeiro, segundo];
    });
    expect(nomes).toEqual([s.servicos.nomes[1], 'Alterado fora']);
  });
});
