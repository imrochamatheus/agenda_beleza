import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { anonimizarCliente } from '@/server/clientes/anonimizar';
import { cancelarItem } from '@/server/reservas/cancelar';
import { cancelarTodos } from '@/server/reservas/cancelar-todos';
import { marcarStatusDoItem } from '@/server/reservas/marcar-status';
import { remarcarItem } from '@/server/reservas/remarcar';
import { cancelarItemAcao, cancelarTodosAcao, marcarStatusDoItemAcao, remarcarItemAcao } from '@/server/reservas/reservas-status.acao';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';

import { credencialDoGestor, credencialDoProfissional } from '../../../support/auth';
import { contarLinhas } from '../../../support/reservas';
import { aplicarSituacao } from '../../../support/politica';

import type { Cenario } from './apoio';
import { AGORA, conferirDerivados, criarCenario, criarComItens, ctxProfissional, DEPOIS, filaEspia, itemDe, mensagensDe, reservaDe } from './apoio';

// D-050 T-6: permissões por item (CA-30, RN-25), "cancelar todos" só do gestor (A-14), isolamento (CA-50),
// salão suspenso (CA-31, D-038) e cliente anonimizada (CA-42, RN-26). PostgreSQL real.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const deps = () => ({ enfileirar: filaEspia().enfileirar });

/** Reserva com X (A, Ana, 10:00) e Y (C, Bia, 11:00). */
const reservaDeDois = (c: Cenario) => criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);

describe('CA-30: profissional só opera os próprios itens', () => {
  it('Bia em X (da Ana): remarcar, cancelar e marcar status → 403 e nada muda', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await reservaDeDois(c);
    const bia = ctxProfissional(c, c.bia);
    const antes = { r: await reservaDe(id), n: await contarLinhas(c.s.salaoId) };
    await expect(remarcarItem(bia, { reservaId: id, itemId: x, hora: '14:00' }, AGORA, deps())).rejects.toBeInstanceOf(AcessoNegado);
    await expect(remarcarItem(bia, { reservaId: id, itemId: x, hora: '14:00', profissionalId: c.bia }, AGORA, deps())).rejects.toBeInstanceOf(AcessoNegado);
    await expect(cancelarItem(bia, { reservaId: id, itemId: x }, AGORA, deps())).rejects.toBeInstanceOf(AcessoNegado);
    await expect(marcarStatusDoItem(bia, { reservaId: id, itemId: x, destino: 'concluido' }, DEPOIS, deps())).rejects.toBeInstanceOf(AcessoNegado);
    expect(await reservaDe(id)).toEqual(antes.r);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes.n);
  });

  it('Bia no próprio Y: remarcar, cancelar e marcar funcionam; mover Y para a Ana → 403', async () => {
    const c = await criarCenario();
    const { id, itens: [, y] } = await reservaDeDois(c);
    const bia = ctxProfissional(c, c.bia);
    await expect(remarcarItem(bia, { reservaId: id, itemId: y, hora: '14:00', profissionalId: c.ana }, AGORA, deps())).rejects.toBeInstanceOf(AcessoNegado);
    expect(await remarcarItem(bia, { reservaId: id, itemId: y, hora: '14:00' }, AGORA, deps())).toMatchObject({ resultado: 'atualizada' });
    expect(await marcarStatusDoItem(bia, { reservaId: id, itemId: y, destino: 'concluido' }, DEPOIS, deps())).toMatchObject({ resultado: 'atualizada' });

    const outra = await criarComItens(c, [{ hora: '16:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '17:00' }]);
    expect(await cancelarItem(bia, { reservaId: outra.id, itemId: outra.itens[1] }, AGORA, deps())).toMatchObject({ resultado: 'atualizada' });
    await conferirDerivados(id);
    await conferirDerivados(outra.id);
  });

  it('cancelar todos: profissional → 403 mesmo com todos os itens dele; gestor funciona', async () => {
    const c = await criarCenario();
    const { id } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, hora: '11:00' }]);
    await expect(cancelarTodos(ctxProfissional(c, c.ana), { reservaId: id }, AGORA, deps())).rejects.toBeInstanceOf(AcessoNegado);
    expect((await reservaDe(id)).status).toBe('confirmado');
    expect(await cancelarTodos(c.ctxEquipe, { reservaId: id }, AGORA, deps())).toMatchObject({ resultado: 'atualizada' });
  });

  it('pelas ações (defineAcao, sessão real): Ana recebe 403 no item da Bia e em cancelar todos; no próprio item funciona', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await reservaDeDois(c);
    const cred = await credencialDoProfissional(c.s);
    const negado = { ok: false, erro: 'acesso_negado', status: 403 };
    expect(await remarcarItemAcao.executar(cred, { reservaId: id, itemId: y, hora: '14:00' })).toEqual(negado);
    expect(await cancelarItemAcao.executar(cred, { reservaId: id, itemId: y })).toEqual(negado);
    expect(await marcarStatusDoItemAcao.executar(cred, { reservaId: id, itemId: y, destino: 'concluido' })).toEqual(negado);
    expect(await cancelarTodosAcao.executar(cred, { reservaId: id })).toEqual(negado);
    expect(await reservaDe(id)).toMatchObject({ revisao: 0, status: 'confirmado' });
    expect(await cancelarItemAcao.executar(cred, { reservaId: id, itemId: x })).toMatchObject({ ok: true, dados: { resultado: 'atualizada', itemId: x } });
    const gestor = await credencialDoGestor(c.s);
    expect(await cancelarTodosAcao.executar(gestor, { reservaId: id })).toMatchObject({ ok: true, dados: { resultado: 'atualizada', itemIds: [y] } });
    await conferirDerivados(id);
  });
});

describe('CA-30/CA-50: outro salão, id malformado, item de outra reserva → 404 uniforme', () => {
  it('toda operação do salão B sobre a reserva do salão A → NaoEncontrado, nada muda', async () => {
    const a = await criarCenario();
    const b = await criarCenario();
    const { id, itens: [x] } = await reservaDeDois(a);
    const antes = await reservaDe(id);
    for (const ctx of [b.ctxEquipe, ctxProfissional(b, b.ana)]) {
      await expect(remarcarItem(ctx, { reservaId: id, itemId: x, hora: '14:00' }, AGORA, deps())).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(cancelarItem(ctx, { reservaId: id, itemId: x }, AGORA, deps())).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(marcarStatusDoItem(ctx, { reservaId: id, itemId: x, destino: 'concluido' }, DEPOIS, deps())).rejects.toBeInstanceOf(NaoEncontrado);
    }
    await expect(cancelarTodos(b.ctxEquipe, { reservaId: id }, AGORA, deps())).rejects.toBeInstanceOf(NaoEncontrado);
    expect(await reservaDe(id)).toEqual(antes);
  });

  it('ids malformados e item de outra reserva do mesmo salão → NaoEncontrado', async () => {
    const c = await criarCenario();
    const um = await reservaDeDois(c);
    const outra = await criarComItens(c, [{ hora: '15:00' }]);
    for (const [reservaId, itemId] of [
      ['xyz', um.itens[0]],
      [um.id, 'xyz'],
      [um.id, 7],
      [undefined, um.itens[0]],
      [um.id, outra.itens[0]],
      [um.id, '00000000-0000-4000-8000-000000000000'],
    ] as const) {
      await expect(cancelarItem(c.ctxEquipe, { reservaId, itemId }, AGORA, deps())).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(remarcarItem(c.ctxEquipe, { reservaId, itemId, hora: '14:00' }, AGORA, deps())).rejects.toBeInstanceOf(NaoEncontrado);
    }
    await expect(cancelarTodos(c.ctxEquipe, { reservaId: 'xyz' }, AGORA, deps())).rejects.toBeInstanceOf(NaoEncontrado);
    expect((await itemDe(outra.itens[0])).status).toBe('confirmado');
  });
});

describe('CA-31: salão somente leitura (D-038)', () => {
  it.each(['suspensa', 'manual'] as const)('%s: cancelar item e cancelar todos funcionam e registram a mensagem; remarcar → 403', async (situacao) => {
    const c = await criarCenario();
    const { id, itens: [x] } = await reservaDeDois(c);
    await aplicarSituacao(c.s.salaoId, situacao);
    await expect(remarcarItem(c.ctxEquipe, { reservaId: id, itemId: x, hora: '14:00' }, AGORA, deps())).rejects.toMatchObject({ status: 403 });
    expect((await reservaDe(id)).revisao).toBe(0);

    const fila = filaEspia();
    expect(await cancelarItem(c.ctxEquipe, { reservaId: id, itemId: x }, AGORA, { enfileirar: fila.enfileirar })).toMatchObject({ resultado: 'atualizada' });
    expect(fila.chaves()).toEqual([`${id}:cancelamento:1`]);
    expect(await cancelarTodos(c.ctxEquipe, { reservaId: id }, AGORA, deps())).toMatchObject({ resultado: 'atualizada', statusReserva: 'cancelado', revisao: 2 });
    expect((await mensagensDe(id)).filter((m) => m.tipo === 'cancelamento')).toEqual([
      { tipo: 'cancelamento', revisao: 1, estado: 'pendente', reservaItemId: x },
      { tipo: 'cancelamento', revisao: 2, estado: 'pendente', reservaItemId: null },
    ]);
    await conferirDerivados(id);
  });
});

describe('CA-42: cliente anonimizada', () => {
  it('cancelar e remarcar item funcionam; mensagens nascem cancelada_anonimizacao e nada é enfileirado', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await reservaDeDois(c);
    const { clienteId } = await reservaDe(id);
    expect(await anonimizarCliente(c.ctxEquipe, { clienteId }, AGORA)).toMatchObject({ resultado: 'anonimizada' });
    const fila = filaEspia();
    expect(await remarcarItem(c.ctxEquipe, { reservaId: id, itemId: x, hora: '14:00' }, AGORA, { enfileirar: fila.enfileirar })).toMatchObject({
      resultado: 'atualizada',
      mensagem: { estado: 'cancelada_anonimizacao' },
    });
    expect(await cancelarItem(c.ctxEquipe, { reservaId: id, itemId: y }, AGORA, { enfileirar: fila.enfileirar })).toMatchObject({
      resultado: 'atualizada',
      mensagens: [{ estado: 'cancelada_anonimizacao' }],
    });
    expect(fila.total()).toBe(0);
    expect((await mensagensDe(id)).filter((m) => m.tipo !== 'confirmacao').map((m) => m.estado)).toEqual(['cancelada_anonimizacao', 'cancelada_anonimizacao']);
    await conferirDerivados(id);
  });
});
