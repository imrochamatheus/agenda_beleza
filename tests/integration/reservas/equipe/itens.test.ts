import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReservaDaEquipe } from '@/server/reservas/reserva-equipe';
import { criarReservaManual } from '@/server/reservas/reservas-equipe.acao';
import { obterPrisma } from '@/server/repos/db';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';

import { credencialDoGestor, credencialDoProfissional } from '../../../support/auth';
import { DIA, conferirDerivados, contarLinhas, criarCenarioReserva, sp } from '../../../support/reservas';
import type { CenarioReserva } from '../../../support/reservas';

import { AGORA, comTresProfissionais, ctxProfissional, enfileirar, entradaEquipe, itensGravados, linha } from './apoio';

// D-050 (E3.6) T-12: nova reserva da equipe com N itens (serviço, profissional e hora por item, uma data),
// contra PostgreSQL real. CA-23 (encaixe por item, nada gravado sem confirmar), CA-24 (profissional só com
// itens próprios: 403 sem escrita), sobreposição entre itens como erro da linha e CA-50 (isolamento).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();

async function cenarioDeTres(): Promise<CenarioReserva & { C: string; carla: string }> {
  const c = await criarCenarioReserva();
  return { ...c, ...(await comTresProfissionais(c)) };
}

/** A reserva do exemplo: A com a Bia às 09:00, B com a Ana às 10:00 e C com a Carla na hora dada. */
const tresItens = (c: CenarioReserva & { C: string; carla: string }, horaCarla = '19:30') => [
  linha(c.A, c.bia, '09:00'),
  linha(c.B, c.ana, '10:00'),
  linha(c.C, c.carla, horaCarla),
];

describe('CA-23: gestor, 3 itens em 3 profissionais, um fora da jornada', () => {
  it('sem confirmar: só o item 3 é listado com o motivo e nada é gravado (nem cliente, nem mensagem)', async () => {
    const c = await cenarioDeTres();
    const antes = await contarLinhas(c.s.salaoId);
    const r = await criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, { itens: tresItens(c) }), AGORA, { enfileirar });
    expect(r).toEqual({ resultado: 'encaixe_requer_confirmacao', motivos: [{ indice: 2, motivos: ['fora_da_jornada'] }] });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('confirmando: uma reserva com 3 itens, encaixe = true só no item da Carla; derivados coerentes', async () => {
    const c = await cenarioDeTres();
    const fila = vi.fn(enfileirar);
    const r = await criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, { itens: tresItens(c), confirmarEncaixe: 'on' }), AGORA, { enfileirar: fila });
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    expect(r.reserva.origem).toBe('equipe');
    const itens = await itensGravados(c.s.salaoId);
    expect(itens.map((i) => [i.profissionalId, i.servicoId, i.ordem, i.inicio, i.encaixe, i.status])).toEqual([
      [c.bia, c.A, 0, sp(DIA, '09:00'), false, 'confirmado'],
      [c.ana, c.B, 1, sp(DIA, '10:00'), false, 'confirmado'],
      [c.carla, c.C, 2, sp(DIA, '19:30'), true, 'confirmado'],
    ]);
    expect(new Set(itens.map((i) => i.reservaId))).toEqual(new Set([r.reserva.id]));
    expect(await conferirDerivados(r.reserva.id)).toBe(1);
    // Uma confirmação consolidada (pendente: mensagens aceitas), enfileirada uma vez depois do commit.
    expect(r.confirmacao.estado).toBe('pendente');
    expect(fila).toHaveBeenCalledTimes(1);
    expect(await db().mensagem.count({ where: { salaoId: c.s.salaoId } })).toBe(1);
  });

  it('dentro das regras: criada sem pedir confirmação e sem encaixe em nenhum item', async () => {
    const c = await cenarioDeTres();
    const r = await criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, { itens: tresItens(c, '15:00') }), AGORA, { enfileirar });
    expect(r.resultado === 'criada' && r.reserva.itens.map((i) => i.encaixe)).toEqual([false, false, false]);
  });

  it('motivos em mais de um item: a resposta lista cada um com seus motivos', async () => {
    const c = await cenarioDeTres();
    await db().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: c.bia, inicio: sp(DIA, '08:30'), fim: sp(DIA, '09:30') } });
    const r = await criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, { itens: tresItens(c) }), AGORA, { enfileirar });
    expect(r).toEqual({
      resultado: 'encaixe_requer_confirmacao',
      motivos: [
        { indice: 0, motivos: ['bloqueado'] },
        { indice: 2, motivos: ['fora_da_jornada'] },
      ],
    });
  });
});

describe('sobreposição entre itens (RN-8/RN-9) e campos por linha', () => {
  it('dois itens que se cruzam: erro na hora do item posterior citando o outro; nada gravado', async () => {
    const c = await cenarioDeTres();
    const antes = await contarLinhas(c.s.salaoId);
    // B (45 min) com a Ana às 10:00 e C com a Carla às 10:30: a cliente estaria em dois lugares.
    const r = await criarReservaDaEquipe(
      c.ctxEquipe,
      entradaEquipe(c, { itens: [linha(c.B, c.ana, '10:00'), linha(c.C, c.carla, '10:30')] }),
      AGORA,
      { enfileirar },
    );
    expect(r).toEqual({ resultado: 'invalido', erros: { porItem: { 1: { inicio: 'Este horário se sobrepõe ao Serviço 1 (B, 10:00–10:45).' } } } });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('itens adjacentes são aceitos', async () => {
    const c = await cenarioDeTres();
    const r = await criarReservaDaEquipe(
      c.ctxEquipe,
      entradaEquipe(c, { itens: [linha(c.B, c.ana, '10:00'), linha(c.C, c.carla, '10:45')] }),
      AGORA,
      { enfileirar },
    );
    expect(r.resultado).toBe('criada');
  });

  it('linha sem profissional (gestor deixou "Escolha…"): erro no campo, não 404', async () => {
    const c = await cenarioDeTres();
    const r = await criarReservaDaEquipe(
      c.ctxEquipe,
      entradaEquipe(c, { itens: [linha(c.A, c.ana, '10:00'), linha(c.B, '', '')] }),
      AGORA,
      { enfileirar },
    );
    expect(r).toEqual({
      resultado: 'invalido',
      erros: { porItem: { 1: { profissional: 'Escolha o profissional.', inicio: 'Informe a hora no formato HH:MM.' } } },
    });
  });

  it('um item ocupado por outra reserva da profissional: horario_indisponivel e nada gravado', async () => {
    const c = await cenarioDeTres();
    await criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, { itens: [linha(c.C, c.carla, '15:00')] }), AGORA, { enfileirar });
    const antes = await contarLinhas(c.s.salaoId);
    const r = await criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, { itens: tresItens(c, '15:10') }), AGORA, { enfileirar });
    expect(r).toMatchObject({ resultado: 'horario_indisponivel' });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });
});

describe('CA-24: profissional logado', () => {
  it('só itens dela (2 serviços): criada; com um item de outra profissional do salão: AcessoNegado e nada gravado', async () => {
    const c = await cenarioDeTres();
    const ctxP = ctxProfissional(c);
    const ok = await criarReservaDaEquipe(ctxP, entradaEquipe(c, { itens: [linha(c.A, c.ana, '10:00'), linha(c.B, c.ana, '10:30')] }), AGORA, {
      enfileirar,
    });
    expect(ok.resultado === 'criada' && ok.reserva.itens.map((i) => i.profissionalId)).toEqual([c.ana, c.ana]);

    const antes = await contarLinhas(c.s.salaoId);
    await expect(
      criarReservaDaEquipe(ctxP, entradaEquipe(c, { itens: [linha(c.A, c.ana, '14:00'), linha(c.C, c.carla, '15:00')] }), AGORA, { enfileirar }),
    ).rejects.toBeInstanceOf(AcessoNegado);
    // Mesmo com o formulário inválido em outros campos, o 403 vem antes (nenhuma validação revela nada).
    await expect(
      criarReservaDaEquipe(ctxP, entradaEquipe(c, { nome: '', itens: [linha('', c.bia, 'x')] }), AGORA, { enfileirar }),
    ).rejects.toBeInstanceOf(AcessoNegado);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('item com profissional de outro salão ou malformado: 404 (antes do 403), nada gravado em nenhum salão', async () => {
    const c = await cenarioDeTres();
    const outro = await criarCenarioReserva();
    const ctxP = ctxProfissional(c);
    const antes = [await contarLinhas(c.s.salaoId), await contarLinhas(outro.s.salaoId)];
    for (const estranho of [outro.ana, 'nao-e-uuid']) {
      await expect(
        criarReservaDaEquipe(ctxP, entradaEquipe(c, { itens: [linha(c.A, c.bia, '10:00'), linha(c.B, estranho, '11:00')] }), AGORA, { enfileirar }),
      ).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(
        criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, { itens: [linha(c.A, c.ana, '10:00'), linha(c.B, estranho, '11:00')] }), AGORA, { enfileirar }),
      ).rejects.toBeInstanceOf(NaoEncontrado);
    }
    expect([await contarLinhas(c.s.salaoId), await contarLinhas(outro.s.salaoId)]).toEqual(antes);
  });

  it('pela ação com sessão real: 403 com item de outra profissional; 200 só com itens próprios', async () => {
    const c = await cenarioDeTres();
    const prof = await credencialDoProfissional(c.s);
    const gestor = await credencialDoGestor(c.s);
    const negado = await criarReservaManual.executar(prof, entradaEquipe(c, { itens: [linha(c.A, c.ana, '10:00'), linha(c.C, c.carla, '11:00')] }), {
      agora: AGORA,
    });
    expect(negado).toEqual({ ok: false, erro: 'acesso_negado', status: 403 });
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
    const proprio = await criarReservaManual.executar(prof, entradaEquipe(c, { itens: [linha(c.A, c.ana, '13:00'), linha(c.B, c.ana, '13:30')] }), {
      agora: AGORA,
    });
    expect(proprio.ok && proprio.dados.resultado).toBe('criada');
    const doGestor = await criarReservaManual.executar(gestor, entradaEquipe(c, { itens: tresItens(c, '15:00'), chaveRequisicao: randomUUID() }), {
      agora: AGORA,
    });
    expect(doGestor.ok && doGestor.dados.resultado).toBe('criada');
    await conferirDerivados({ salaoId: c.s.salaoId });
  });
});

describe('CA-50: isolamento', () => {
  it('serviço de outro salão numa linha: servico_indisponivel e nada gravado em nenhum dos dois', async () => {
    const c = await cenarioDeTres();
    const outro = await criarCenarioReserva();
    const antes = [await contarLinhas(c.s.salaoId), await contarLinhas(outro.s.salaoId)];
    const r = await criarReservaDaEquipe(
      c.ctxEquipe,
      entradaEquipe(c, { itens: [linha(c.A, c.ana, '10:00'), linha(outro.B, c.ana, '11:00')] }),
      AGORA,
      { enfileirar },
    );
    expect(r).toEqual({ resultado: 'servico_indisponivel' });
    expect([await contarLinhas(c.s.salaoId), await contarLinhas(outro.s.salaoId)]).toEqual(antes);
  });

  it('a ocupação de outro salão nunca conflita: mesma hora, mesmo desenho, duas reservas', async () => {
    const a = await cenarioDeTres();
    const b = await cenarioDeTres();
    const ra = await criarReservaDaEquipe(a.ctxEquipe, entradaEquipe(a, { itens: tresItens(a, '15:00') }), AGORA, { enfileirar });
    const rb = await criarReservaDaEquipe(b.ctxEquipe, entradaEquipe(b, { itens: tresItens(b, '15:00') }), AGORA, { enfileirar });
    expect([ra.resultado, rb.resultado]).toEqual(['criada', 'criada']);
  });
});
