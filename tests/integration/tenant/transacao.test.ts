import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';
import { resolverTenant } from '@/server/tenant/sessao';

import { credencialDoGestor } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conferirDerivados } from '../../support/reservas';
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
    // D-050: `atualizarStatus` saiu de RepoReserva; a escrita de reserva aqui é criar + criarItens
    // (reserva e item na mesma transação que as renomeações).
    const inicio = new Date(s.reserva.fim.getTime() + 24 * 60 * 60_000);
    const fim = new Date(inicio.getTime() + 30 * 60_000);
    const resultado = await emTransacao(async (r) => {
      const servico = await r.servicos.renomear(ctx, s.servicos.ativos[0], 'Corte confirmado');
      const profissional = await r.profissionais.renomear(ctx, s.profissional.profissionalId, 'Ana Confirmada');
      const nova = await r.reservas.criar(ctx, { clienteId: s.clientes.ativaId, origem: 'equipe', chaveRequisicao: null, inicio, fim });
      if (!nova.criada) throw new Error('reserva não criada');
      await r.reservas.criarItens(ctx, nova.id, [
        {
          servicoId: s.servicos.ativos[1],
          profissionalId: s.profissional.profissionalId,
          ordem: 0,
          inicio,
          fim,
          ocupadoAte: fim,
          precoCentavos: 5500,
          duracaoMin: 30,
          encaixe: false,
        },
      ]);
      return { servico: servico.nome, profissional: profissional.nome, reservaId: nova.id };
    });
    expect(resultado).toMatchObject({ servico: 'Corte confirmado', profissional: 'Ana Confirmada' });
    const depois = await estado();
    expect((depois.servico as { nome: string }).nome).toBe('Corte confirmado');
    const p = await c.query('SELECT nome FROM profissional WHERE id = $1', [s.profissional.profissionalId]);
    expect(p.rows).toEqual([{ nome: 'Ana Confirmada' }]);
    const itens = await c.query('SELECT status::text AS status, profissional_id::text AS p FROM reserva_item WHERE reserva_id = $1', [
      resultado.reservaId,
    ]);
    expect(itens.rows).toEqual([{ status: 'confirmado', p: s.profissional.profissionalId }]);
    expect(await conferirDerivados(resultado.reservaId)).toBe(1);
  });

  it('CA-14: falha DEPOIS de criar reserva e itens desfaz também a reserva e os itens', async () => {
    const inicio = new Date(s.reserva.fim.getTime() + 2 * 24 * 60 * 60_000);
    const fim = new Date(inicio.getTime() + 30 * 60_000);
    const contar = async () =>
      (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM reserva_item WHERE salao_id = $1', [s.salaoId])).rows[0].n;
    const antes = await contar();
    const erro = new Error('falha proposital');
    await expect(
      emTransacao(async (r) => {
        const nova = await r.reservas.criar(ctx, { clienteId: s.clientes.ativaId, origem: 'equipe', chaveRequisicao: null, inicio, fim });
        if (!nova.criada) throw new Error('reserva não criada');
        await r.reservas.criarItens(ctx, nova.id, [
          { servicoId: s.servicos.ativos[0], profissionalId: s.profissional.profissionalId, ordem: 0, inicio, fim, ocupadoAte: fim, precoCentavos: 1, duracaoMin: 30, encaixe: false },
        ]);
        throw erro;
      }),
    ).rejects.toBe(erro);
    expect(await contar()).toBe(antes);
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
