import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { anonimizarCliente } from '@/server/clientes/anonimizar';
import { criarReserva } from '@/server/reservas/criar-reserva';
import { cancelarItem } from '@/server/reservas/cancelar';
import { cancelarTodos } from '@/server/reservas/cancelar-todos';
import { marcarStatusDoItem } from '@/server/reservas/marcar-status';
import { remarcarItem } from '@/server/reservas/remarcar';
import { AcessoNegado } from '@/server/tenant/erros';

import { conferirDerivados, contarLinhas, criarCenarioReserva, entradaReserva } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { aplicarSituacao } from '../../support/politica';
import type { SituacaoDeTeste } from '../../support/politica';
import { AGORA, criarCenario, criarComItens, db, DEPOIS, DIA, filaEspia, mensagensDe, reservaDe, sp } from '../reservas/alteracao/apoio';

// D-038 CA-1, CA-2, CA-3, CA-6, CA-10 e isolamento: criar, remarcar, cancelar, marcar status e anonimizar com o
// salão em cada situação, contra PostgreSQL real (sem mocks de banco). D-050 (CA-14, CA-31): as operações são
// por item; "cancelar todos" também é `cancelar` (o salão suspenso cancela e notifica).

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
    await expect(criarReserva(c.ctxEquipe, entradaReserva(c, { modo: 'encaixe', itens: [{ servicoId: c.A, profissionalId: c.ana, inicio: sp(DIA, '07:00') }] }), { consentimentoOpcional: true })).rejects.toBeInstanceOf(AcessoNegado);

    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
    expect(await db().reserva.count({ where: { salaoId: c.s.salaoId, chaveRequisicao: chave } })).toBe(0);
  });
});

describe('criar reserva nas situações que permitem (CA-10)', () => {
  it.each(['em_teste', 'ativa', 'em_carencia', 'cancelada', 'sem_assinatura'] as SituacaoDeTeste[])('%s: criada para público e equipe', async (situacao) => {
    const c = await criarCenarioReserva();
    await aplicarSituacao(c.s.salaoId, situacao);
    expect((await criarReserva(c.ctxSistema, entradaReserva(c))).resultado).toBe('criada');
    expect((await criarReserva(c.ctxEquipe, entradaReserva(c, { itens: [{ servicoId: c.A, profissionalId: c.ana, inicio: sp(DIA, '12:00') }] }))).resultado).toBe('criada');
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

describe('remarcar item com o salão somente leitura (CA-2, CA-31)', () => {
  it.each([...SO_LEITURA, 'pendente'] as SituacaoDeTeste[])('%s: 403, reserva e mensagens intactas', async (situacao) => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    await aplicarSituacao(c.s.salaoId, situacao);
    const antes = { linha: await reservaDe(id), msgs: await mensagensDe(id) };
    const fila = filaEspia();
    await expect(
      remarcarItem(c.ctxEquipe, { reservaId: id, itemId: x, hora: '14:00' }, AGORA, { enfileirar: fila.enfileirar }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await reservaDe(id)).toEqual(antes.linha);
    expect(await mensagensDe(id)).toEqual(antes.msgs);
    expect(fila.total()).toBe(0);
  });
});

describe('cancelar continua e notifica (CA-3, CA-31)', () => {
  it.each(SO_LEITURA)('%s: item futuro cancelado, mensagem cancelamento no outbox e enfileirada depois do commit', async (situacao) => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    await aplicarSituacao(c.s.salaoId, situacao);
    const fila = filaEspia();
    const r = await cancelarItem(c.ctxEquipe, { reservaId: id, itemId: x }, AGORA, { enfileirar: fila.enfileirar });
    expect(r).toMatchObject({ resultado: 'atualizada', status: 'cancelado', statusReserva: 'cancelado', revisao: 1 });
    const linha = await reservaDe(id);
    expect(linha.status).toBe('cancelado');
    expect(await mensagensDe(id)).toEqual([
      { tipo: 'confirmacao', revisao: 0, estado: 'substituida', reservaItemId: null },
      { tipo: 'cancelamento', revisao: 1, estado: 'pendente', reservaItemId: x },
    ]);
    expect(fila.chaves()).toEqual([`${id}:cancelamento:1`]);
    await conferirDerivados(id);
  });

  it.each(SO_LEITURA)('%s: cancelar todos também é permitido e gera UMA mensagem sem item', async (situacao) => {
    const c = await criarCenario();
    const { id } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.B, hora: '11:00' }]);
    await aplicarSituacao(c.s.salaoId, situacao);
    const fila = filaEspia();
    expect(await cancelarTodos(c.ctxEquipe, { reservaId: id }, AGORA, { enfileirar: fila.enfileirar })).toMatchObject({
      resultado: 'atualizada',
      statusReserva: 'cancelado',
    });
    expect(fila.chaves()).toEqual([`${id}:cancelamento:1`]);
  });

  it('marcar concluído e não compareceu de itens passados é aceito em salão suspenso', async () => {
    const c = await criarCenario();
    const a = await criarComItens(c, [{ hora: '09:00' }]);
    const b = await criarComItens(c, [{ hora: '10:00' }]);
    await aplicarSituacao(c.s.salaoId, 'suspensa');
    expect(await marcarStatusDoItem(c.ctxEquipe, { reservaId: a.id, itemId: a.itens[0], destino: 'concluido' }, DEPOIS, { enfileirar: filaEspia().enfileirar })).toMatchObject({
      resultado: 'atualizada',
      status: 'concluido',
    });
    expect(await marcarStatusDoItem(c.ctxEquipe, { reservaId: b.id, itemId: b.itens[0], destino: 'nao_compareceu' }, DEPOIS, { enfileirar: filaEspia().enfileirar })).toMatchObject({
      resultado: 'atualizada',
      status: 'nao_compareceu',
    });
    expect((await reservaDe(a.id)).status).toBe('concluido');
    expect((await reservaDe(b.id)).status).toBe('nao_compareceu');
  });

  it('anonimizar cliente (lgpd) é aceito em salão suspenso', async () => {
    const c = await criarCenario();
    const { id } = await criarComItens(c, [{ hora: '10:00' }]);
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
    expect(await criarReserva(b.ctxSistema, entradaReserva(b, { itens: [{ servicoId: b.A, profissionalId: b.ana, inicio: sp(DIA, '12:00') }] }))).toEqual({ resultado: 'salao_indisponivel' });
    expect(await contarLinhas(a.s.salaoId)).toMatchObject({ reserva: 0 });
    expect(await contarLinhas(b.s.salaoId)).toMatchObject({ reserva: 1 });
  });
});
