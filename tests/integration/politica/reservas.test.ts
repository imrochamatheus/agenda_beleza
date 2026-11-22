import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { anonimizarCliente } from '@/server/clientes/anonimizar';
import { criarReserva } from '@/server/reservas/criar-reserva';
import { cancelarReserva } from '@/server/reservas/cancelar';
import { marcarStatusReserva } from '@/server/reservas/marcar-status';
import { remarcarReserva } from '@/server/reservas/remarcar';
import { AcessoNegado } from '@/server/tenant/erros';

import { contarLinhas, criarCenarioReserva, entradaReserva, inserirReservaDireta } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { aplicarSituacao } from '../../support/politica';
import type { SituacaoDeTeste } from '../../support/politica';
import { AGORA, criarCenario, criarConfirmada, db, DIA, filaEspia, mensagensDe, reservaDe, sp } from '../reservas/alteracao/apoio';

// D-038 CA-1, CA-2, CA-3, CA-6, CA-10 e isolamento: criar, remarcar, cancelar, marcar status e anonimizar com o
// salão em cada situação, contra PostgreSQL real (sem mocks de banco).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const SO_LEITURA: SituacaoDeTeste[] = ['suspensa', 'encerrada', 'manual'];

describe.each([...SO_LEITURA, 'pendente'] as SituacaoDeTeste[])('criar reserva com o salão %s (CA-1, CA-2, CA-6)', (situacao) => {
  it('público: salao_indisponivel; equipe: 403; encaixe: 403; nada é gravado e a chave não é consumida', async () => {
    const c = await criarCenarioReserva();
    await aplicarSituacao(c.s.salaoId, situacao);
    const chave = '7b3c2c52-6f0e-4d8a-9f43-0c2b1b9a1111';
    const antes = await contarLinhas(c.s.salaoId);

    expect(await criarReserva(c.ctxSistema, entradaReserva(c, { chaveRequisicao: chave }))).toEqual({ resultado: 'salao_indisponivel' });
    await expect(criarReserva(c.ctxEquipe, entradaReserva(c))).rejects.toBeInstanceOf(AcessoNegado);
    await expect(criarReserva(c.ctxEquipe, entradaReserva(c, { modo: 'encaixe', inicio: sp(DIA, '07:00') }), { consentimentoOpcional: true })).rejects.toBeInstanceOf(AcessoNegado);

    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
    expect(await db().reserva.count({ where: { salaoId: c.s.salaoId, chaveRequisicao: chave } })).toBe(0);
  });
});

describe('criar reserva nas situações que permitem (CA-10)', () => {
  it.each(['em_teste', 'ativa', 'em_carencia', 'cancelada', 'sem_assinatura'] as SituacaoDeTeste[])('%s: criada para público e equipe', async (situacao) => {
    const c = await criarCenarioReserva();
    await aplicarSituacao(c.s.salaoId, situacao);
    expect((await criarReserva(c.ctxSistema, entradaReserva(c))).resultado).toBe('criada');
    expect((await criarReserva(c.ctxEquipe, entradaReserva(c, { inicio: sp(DIA, '12:00') }))).resultado).toBe('criada');
  });

  it('cancelada vencida (acessoAte no passado) conta como encerrada: recusa', async () => {
    const c = await criarCenarioReserva();
    await aplicarSituacao(c.s.salaoId, 'cancelada_vencida');
    expect(await criarReserva(c.ctxSistema, entradaReserva(c))).toEqual({ resultado: 'salao_indisponivel' });
  });

  it('reativar o estado vale na chamada seguinte (sem cache): suspensa → recusa; depois ativa → cria', async () => {
    const c = await criarCenarioReserva();
    await aplicarSituacao(c.s.salaoId, 'suspensa');
    expect(await criarReserva(c.ctxSistema, entradaReserva(c))).toEqual({ resultado: 'salao_indisponivel' });
    await db().assinatura.updateMany({ where: { salaoId: c.s.salaoId }, data: { estado: 'ativa' } });
    expect((await criarReserva(c.ctxSistema, entradaReserva(c))).resultado).toBe('criada');
  });
});

describe('remarcar com o salão somente leitura (CA-2)', () => {
  it.each([...SO_LEITURA, 'pendente'] as SituacaoDeTeste[])('%s: 403, reserva e mensagens intactas', async (situacao) => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    await aplicarSituacao(c.s.salaoId, situacao);
    const antes = { linha: await reservaDe(id), msgs: await mensagensDe(id) };
    const fila = filaEspia();
    await expect(
      remarcarReserva(c.ctxEquipe, { reservaId: id, data: '2026-12-01', hora: '14:00', profissionalId: c.ana, servicoIds: [c.A] }, AGORA, { enfileirar: fila.enfileirar }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await reservaDe(id)).toEqual(antes.linha);
    expect(await mensagensDe(id)).toEqual(antes.msgs);
    expect(fila.total()).toBe(0);
  });
});

describe('cancelar continua e notifica (CA-3)', () => {
  it.each(SO_LEITURA)('%s: reserva futura cancelada, mensagem cancelamento no outbox e enfileirada depois do commit', async (situacao) => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    await aplicarSituacao(c.s.salaoId, situacao);
    const fila = filaEspia();
    const r = await cancelarReserva(c.ctxEquipe, { reservaId: id }, AGORA, { enfileirar: fila.enfileirar });
    expect(r).toMatchObject({ resultado: 'atualizada', status: 'cancelado' });
    const linha = await reservaDe(id);
    expect(linha.status).toBe('cancelado');
    expect(await mensagensDe(id)).toEqual([
      { tipo: 'confirmacao', revisao: 0, estado: 'substituida' },
      { tipo: 'cancelamento', revisao: linha.revisao, estado: 'pendente' },
    ]);
    expect(fila.chaves()).toEqual([`${id}:cancelamento:${linha.revisao}`]);
  });

  it('marcar concluído e não compareceu de reserva passada é aceito em salão suspenso', async () => {
    const c = await criarCenario();
    const a = await inserirReservaDireta(c, { inicio: sp(DIA, '09:00'), fim: sp(DIA, '09:30') });
    const b = await inserirReservaDireta(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') });
    await aplicarSituacao(c.s.salaoId, 'suspensa');
    const depois = sp(DIA, '12:00');
    expect(await marcarStatusReserva(c.ctxEquipe, { reservaId: a, para: 'concluido' }, depois, { enfileirar: filaEspia().enfileirar })).toMatchObject({ resultado: 'atualizada', status: 'concluido' });
    expect(await marcarStatusReserva(c.ctxEquipe, { reservaId: b, para: 'nao_compareceu' }, depois, { enfileirar: filaEspia().enfileirar })).toMatchObject({ resultado: 'atualizada', status: 'nao_compareceu' });
    expect((await reservaDe(a)).status).toBe('concluido');
    expect((await reservaDe(b)).status).toBe('nao_compareceu');
  });

  it('anonimizar cliente (lgpd) é aceito em salão suspenso', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    await aplicarSituacao(c.s.salaoId, 'suspensa');
    const { clienteId } = await reservaDe(id);
    const r = await anonimizarCliente(c.ctxEquipe, { clienteId }, AGORA);
    expect(r).toMatchObject({ resultado: 'anonimizada' });
    expect((await db().cliente.findUniqueOrThrow({ where: { id: clienteId } })).nome).toBeNull();
  });
});

describe('isolamento entre salões (A suspenso, B livre)', () => {
  it('a recusa de A não afeta B e a leitura de B não libera A', async () => {
    const a: CenarioReserva = await criarCenarioReserva();
    const b: CenarioReserva = await criarCenarioReserva();
    await aplicarSituacao(a.s.salaoId, 'suspensa');
    expect(await criarReserva(a.ctxSistema, entradaReserva(a))).toEqual({ resultado: 'salao_indisponivel' });
    expect((await criarReserva(b.ctxSistema, entradaReserva(b))).resultado).toBe('criada');
    // Contexto de A com o salão B suspenso: continua sendo A quem decide.
    await aplicarSituacao(b.s.salaoId, 'encerrada');
    expect(await criarReserva(b.ctxSistema, entradaReserva(b, { inicio: sp(DIA, '12:00') }))).toEqual({ resultado: 'salao_indisponivel' });
    expect(await contarLinhas(a.s.salaoId)).toMatchObject({ reserva: 0 });
    expect(await contarLinhas(b.s.salaoId)).toMatchObject({ reserva: 1 });
  });
});
