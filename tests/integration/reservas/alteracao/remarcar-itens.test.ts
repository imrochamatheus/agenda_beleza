import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { remarcarItem } from '@/server/reservas/remarcar';
import { cancelarItem } from '@/server/reservas/cancelar';
import type { EntradaRemarcarItem } from '@/server/reservas/tipos-alteracao';

import { contarLinhas, inserirReservaDireta } from '../../../support/reservas';

import type { Cenario } from './apoio';
import { AGORA, conferirDerivados, criarCenario, criarComItens, DEPOIS, DIA, db, filaEspia, forcarStatus, itemDe, mensagensDe, reservaDe, sp } from './apoio';

// D-050 T-6: remarcar UM item (CA-25, CA-26, RN-22, RN-23, M-5, M-6) contra PostgreSQL real, sem mocks de banco.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const remarcar = (c: Cenario, reservaId: string, itemId: string, sobre: Partial<EntradaRemarcarItem> = {}, deps = {}, agora = AGORA) =>
  remarcarItem(c.ctxEquipe, { reservaId, itemId, hora: '14:00', ...sobre }, agora, { enfileirar: filaEspia().enfileirar, ...deps });

/** Retrato de um item sem `atualizadoEm` (para provar "idêntico"). */
const retrato = async (id: string) => {
  const linha: Partial<Awaited<ReturnType<typeof itemDe>>> = { ...(await itemDe(id)) };
  delete linha.atualizadoEm;
  return linha;
};

describe('CA-25: remarcar X para outro horário e profissional', () => {
  it('só X muda; Y idêntico; revisão +1; remarcacao de X registrada e enfileirada; confirmação continua pendente', async () => {
    const c = await criarCenario();
    // X = A com Ana 10:00; Y = C com Bia 11:00.
    const { id, itens: [x, y] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
    const yAntes = await retrato(y);
    const fila = filaEspia();
    const r = await remarcar(c, id, x, { profissionalId: c.bia, hora: '14:00' }, { enfileirar: fila.enfileirar });
    expect(r).toMatchObject({ resultado: 'atualizada', itemId: x, revisao: 1, encaixe: false, mensagem: { estado: 'pendente' } });

    const xi = await itemDe(x);
    expect(xi).toMatchObject({ profissionalId: c.bia, status: 'confirmado', revisao: 1, servicoId: c.A, precoCentavos: 5000, duracaoMin: 30 });
    expect(xi.inicio).toEqual(sp(DIA, '14:00'));
    expect(xi.fim).toEqual(sp(DIA, '14:30'));
    expect(xi.ocupadoAte).toEqual(sp(DIA, '14:30'));
    expect(await retrato(y)).toEqual(yAntes);

    const reserva = await reservaDe(id);
    expect(reserva).toMatchObject({ revisao: 1, status: 'confirmado' });
    expect(reserva.inicio).toEqual(sp(DIA, '11:00'));
    expect(reserva.fim).toEqual(sp(DIA, '14:30'));
    await conferirDerivados(id);

    // RN-31: a confirmação NÃO é substituída por mensagem de item (montada no envio com o estado atual).
    expect(await mensagensDe(id)).toEqual([
      { tipo: 'confirmacao', revisao: 0, estado: 'pendente', reservaItemId: null },
      { tipo: 'remarcacao', revisao: 1, estado: 'pendente', reservaItemId: x },
    ]);
    expect(fila.chaves()).toEqual([`${id}:remarcacao:1`]);
  });

  it('CA-40: remarcar X de novo gera revisão 2 e substitui só a remarcação pendente anterior de X', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
    expect((await remarcar(c, id, x, { hora: '14:00' })).resultado).toBe('atualizada');
    expect((await remarcar(c, id, y, { hora: '15:00' })).resultado).toBe('atualizada');
    expect((await remarcar(c, id, x, { hora: '16:00' })).resultado).toBe('atualizada');
    expect(await mensagensDe(id)).toEqual([
      { tipo: 'confirmacao', revisao: 0, estado: 'pendente', reservaItemId: null },
      { tipo: 'remarcacao', revisao: 1, estado: 'substituida', reservaItemId: x },
      { tipo: 'remarcacao', revisao: 2, estado: 'pendente', reservaItemId: y },
      { tipo: 'remarcacao', revisao: 3, estado: 'pendente', reservaItemId: x },
    ]);
    expect(await itemDe(x)).toMatchObject({ revisao: 3 });
    expect(await itemDe(y)).toMatchObject({ revisao: 2 });
    await conferirDerivados(id);
  });

  it('ausentes = manter: só a hora muda, com a data e o profissional atuais', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    const r = await remarcarItem(c.ctxEquipe, { reservaId: id, itemId: x, hora: '10:15', servicoId: '', profissionalId: '', data: '' }, AGORA, { enfileirar: filaEspia().enfileirar });
    expect(r.resultado).toBe('atualizada');
    expect(await itemDe(x)).toMatchObject({ profissionalId: c.ana, inicio: sp(DIA, '10:15') });
  });

  it('a própria posição não conflita (10:00–10:30 → 10:15–10:45 do mesmo profissional)', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    expect((await remarcar(c, id, x, { hora: '10:15' })).resultado).toBe('atualizada');
  });

  it('intervalo do salão: ocupadoAte = fim + intervalo atual', async () => {
    const c = await criarCenario({ intervaloMin: 10 });
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    await remarcar(c, id, x, { hora: '15:00' });
    expect((await itemDe(x)).ocupadoAte).toEqual(sp(DIA, '15:40'));
  });
});

describe('troca de serviço (RN-22) e M-5', () => {
  it('serviço novo: novo snapshot (preço e duração do serviço travado)', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    const r = await remarcar(c, id, x, { servicoId: c.B, hora: '10:00' });
    expect(r.resultado).toBe('atualizada');
    const xi = await itemDe(x);
    expect(xi).toMatchObject({ servicoId: c.B, precoCentavos: 7000, duracaoMin: 45 });
    expect(xi.fim).toEqual(sp(DIA, '10:45'));
    await conferirDerivados(id);
  });

  it('mesmo serviço: mantém o snapshot mesmo que o serviço tenha mudado de preço/duração', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    await db().servico.update({ where: { id: c.A }, data: { precoCentavos: 9999, duracaoMin: 60 } });
    expect((await remarcar(c, id, x, { hora: '11:00' })).resultado).toBe('atualizada');
    expect(await itemDe(x)).toMatchObject({ precoCentavos: 5000, duracaoMin: 30, fim: sp(DIA, '11:30') });
  });

  it('M-5: trocar para o serviço de OUTRO item da reserva, mesmo cancelado → servico_repetido, sem 23505 e sem gravar', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
    expect((await cancelarItem(c.ctxEquipe, { reservaId: id, itemId: y }, AGORA, { enfileirar: filaEspia().enfileirar })).resultado).toBe('atualizada');
    const antes = { x: await retrato(x), n: await contarLinhas(c.s.salaoId), r: await reservaDe(id) };
    expect(await remarcar(c, id, x, { servicoId: c.C, hora: '15:00' })).toEqual({ resultado: 'recusado', motivo: 'servico_repetido' });
    expect(await retrato(x)).toEqual(antes.x);
    expect(await reservaDe(id)).toEqual(antes.r);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes.n);
  });

  it('serviço novo inativo → servico_indisponivel; serviço de outro salão ou inexistente → servico_indisponivel', async () => {
    const c = await criarCenario();
    const outro = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    await db().servico.update({ where: { id: c.B }, data: { ativo: false } });
    expect(await remarcar(c, id, x, { servicoId: c.B })).toEqual({ resultado: 'servico_indisponivel' });
    expect(await remarcar(c, id, x, { servicoId: outro.A })).toEqual({ resultado: 'servico_indisponivel' });
    expect(await remarcar(c, id, x, { servicoId: 'nao-e-uuid' })).toEqual({ resultado: 'servico_indisponivel' });
    await conferirDerivados(id);
  });

  it('serviço atual inativo continua remarcável (o snapshot é mantido)', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    await db().servico.update({ where: { id: c.A }, data: { ativo: false } });
    expect((await remarcar(c, id, x, { hora: '12:00' })).resultado).toBe('atualizada');
  });

  it('profissional sem vínculo com o serviço → profissional_indisponivel (Bia não faz B)', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ servicoId: c.B, hora: '10:00' }]);
    expect(await remarcar(c, id, x, { profissionalId: c.bia })).toEqual({ resultado: 'profissional_indisponivel' });
  });

  it('profissional alvo inativo, de outro salão ou malformado → profissional_indisponivel', async () => {
    const c = await criarCenario();
    const outro = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    expect(await remarcar(c, id, x, { profissionalId: outro.ana })).toEqual({ resultado: 'profissional_indisponivel' });
    expect(await remarcar(c, id, x, { profissionalId: 'xyz' })).toEqual({ resultado: 'profissional_indisponivel' });
    await db().profissional.update({ where: { id: c.bia }, data: { ativo: false } });
    expect(await remarcar(c, id, x, { profissionalId: c.bia })).toEqual({ resultado: 'profissional_indisponivel' });
    await conferirDerivados(id);
  });
});

describe('CA-26: data (RN-22)', () => {
  it('com outro item não cancelado, outra data → recusado data_diferente; com só X não cancelado, aceita', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
    expect(await remarcar(c, id, x, { data: '2026-12-02', hora: '10:00' })).toEqual({ resultado: 'recusado', motivo: 'data_diferente' });
    // A mesma data, informada explicitamente, é aceita.
    expect((await remarcar(c, id, x, { data: '2026-12-01', hora: '09:00' })).resultado).toBe('atualizada');

    await cancelarItem(c.ctxEquipe, { reservaId: id, itemId: y }, AGORA, { enfileirar: filaEspia().enfileirar });
    expect((await remarcar(c, id, x, { data: '2026-12-02', hora: '10:00' })).resultado).toBe('atualizada');
    const reserva = await reservaDe(id);
    // A-2: o envelope é só do item não cancelado, agora em 02/12.
    expect(reserva.inicio).toEqual(sp({ ano: 2026, mes: 12, dia: 2 }, '10:00'));
    expect(reserva.fim).toEqual(sp({ ano: 2026, mes: 12, dia: 2 }, '10:30'));
    await conferirDerivados(id);
  });

  it('data ou hora malformadas → invalido; início no passado → invalido', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    expect(await remarcar(c, id, x, { hora: '25:00' })).toMatchObject({ resultado: 'invalido', erros: { inicio: expect.any(String) } });
    expect(await remarcar(c, id, x, { data: '2026-13-01' })).toMatchObject({ resultado: 'invalido', erros: { data: expect.any(String) } });
    expect(await remarcar(c, id, x, { servicoId: 7 })).toMatchObject({ resultado: 'invalido', erros: { servico: expect.any(String) } });
    expect(await remarcar(c, id, x, { data: '2026-11-19', hora: '10:00' })).toMatchObject({ resultado: 'invalido', erros: { inicio: expect.any(String) } });
    await conferirDerivados(id);
    expect((await reservaDe(id)).revisao).toBe(0);
  });
});

describe('RN-8/RN-9 entre itens (M-6) e 23P01', () => {
  it('cruzar outro item da reserva (outro profissional) → entre_itens, nunca 23P01', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
    expect(await remarcar(c, id, x, { hora: '10:45' })).toEqual({ resultado: 'horario_indisponivel', causa: 'entre_itens' });
  });

  it('mesmo profissional: o intervalo do salão conta (RN-9), sem 23P01', async () => {
    const c = await criarCenario({ intervaloMin: 10 });
    // X = A Ana 10:00–10:30 (+10); Y = C Ana 11:00–11:20.
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, hora: '11:00' }]);
    // 10:30–11:00 (+10 = 11:10) cruza o Y da Ana.
    expect(await remarcar(c, id, x, { hora: '10:30' })).toEqual({ resultado: 'horario_indisponivel', causa: 'entre_itens' });
    // 11:30 começa 10 min depois do fim de Y (11:20 + 10): aceito.
    expect((await remarcar(c, id, x, { hora: '11:30' })).resultado).toBe('atualizada');
    await conferirDerivados(id);
  });

  it('horário de outra reserva do profissional → horario_indisponivel 23P01, nada gravado nem enfileirado', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    await inserirReservaDireta(c, { inicio: sp(DIA, '14:00'), fim: sp(DIA, '14:30'), profissionalId: c.bia });
    const antes = { r: await reservaDe(id), m: await mensagensDe(id), n: await contarLinhas(c.s.salaoId) };
    const fila = filaEspia();
    expect(await remarcar(c, id, x, { profissionalId: c.bia, hora: '14:15' }, { enfileirar: fila.enfileirar })).toEqual({
      resultado: 'horario_indisponivel',
      causa: '23P01',
    });
    expect(await reservaDe(id)).toEqual(antes.r);
    expect(await mensagensDe(id)).toEqual(antes.m);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes.n);
    expect(fila.total()).toBe(0);
  });
});

describe('recusas pela situação do item', () => {
  it('sem alteração → sem_alteracao; item cancelado → item_final; concluído → transicao_invalida', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y, z] } = await criarComItens(c, [
      { hora: '10:00' },
      { servicoId: c.C, profissionalId: c.bia, hora: '11:00' },
      { servicoId: c.B, hora: '15:00' },
    ]);
    expect(await remarcar(c, id, x, { hora: '10:00' })).toEqual({ resultado: 'recusado', motivo: 'sem_alteracao' });
    await cancelarItem(c.ctxEquipe, { reservaId: id, itemId: y }, AGORA, { enfileirar: filaEspia().enfileirar });
    expect(await remarcar(c, id, y, { hora: '12:00' })).toEqual({ resultado: 'recusado', motivo: 'item_final' });
    await forcarStatus(id, z, 'concluido');
    expect(await remarcar(c, id, z, { hora: '16:00' }, {}, DEPOIS)).toMatchObject({ resultado: 'recusado', motivo: 'transicao_invalida' });
    await conferirDerivados(id);
  });
});

describe('encaixe (RN-17, lote de 1)', () => {
  it('fora da jornada: pede confirmação sem gravar; confirmado grava encaixe = true só em X', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
    const antes = await reservaDe(id);
    expect(await remarcar(c, id, x, { hora: '07:00' })).toEqual({ resultado: 'encaixe_requer_confirmacao', motivos: ['fora_da_jornada'] });
    expect(await reservaDe(id)).toEqual(antes);
    expect(await mensagensDe(id)).toHaveLength(1);

    const r = await remarcar(c, id, x, { hora: '07:00', confirmarEncaixe: 'on' });
    expect(r).toMatchObject({ resultado: 'atualizada', encaixe: true });
    expect(await itemDe(x)).toMatchObject({ encaixe: true, inicio: sp(DIA, '07:00') });
    expect(await itemDe(y)).toMatchObject({ encaixe: false });
    // Remarcar de volta para dentro da jornada limpa o flag.
    expect(await remarcar(c, id, x, { hora: '09:00' })).toMatchObject({ resultado: 'atualizada', encaixe: false });
    await conferirDerivados(id);
  });
});
