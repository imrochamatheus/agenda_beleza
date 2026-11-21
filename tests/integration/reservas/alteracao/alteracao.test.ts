import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { consultarDisponibilidade } from '@/server/disponibilidade/servico';
import { cancelarReserva } from '@/server/reservas/cancelar';
import { marcarStatusReserva } from '@/server/reservas/marcar-status';
import { remarcarReserva } from '@/server/reservas/remarcar';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';

import { criarSalaoCompleto } from '../../../support/factories';
import { contarLinhas, inserirReservaDireta } from '../../../support/reservas';
import type { CenarioReserva } from '../../../support/reservas';

import { AGORA, consentirConvite, criarCenario, criarConfirmada, ctxProfissional, db, DIA, filaEspia, mensagensDe, reservaDe, sp } from './apoio';

// D-030 (E3.5): CA-1..CA-12, CA-14 e CA-R1..R3 contra PostgreSQL real, sem mocks de banco.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const remarcar = (c: CenarioReserva, reservaId: string, sobre: Record<string, unknown> = {}, deps = {}, agora = AGORA) =>
  remarcarReserva(
    c.ctxEquipe,
    { reservaId, data: '2026-12-01', hora: '14:00', profissionalId: c.ana, servicoIds: [c.A], ...sobre },
    agora,
    { enfileirar: filaEspia().enfileirar, ...deps },
  );

describe('CA-1: remarcar para outro profissional', () => {
  it('mesma id, nova posição, revisão +1, mensagem remarcacao pendente e a confirmação substituída', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    const fila = filaEspia();
    const r = await remarcar(c, id, { profissionalId: c.bia }, { enfileirar: fila.enfileirar });
    expect(r.resultado).toBe('atualizada');
    if (r.resultado !== 'atualizada') return;
    expect(r.reserva).toMatchObject({ id, profissionalId: c.bia, revisao: 1, status: 'confirmado' });
    const linha = await reservaDe(id);
    expect(linha).toMatchObject({ id, profissionalId: c.bia, revisao: 1, status: 'confirmado' });
    expect(linha.inicio).toEqual(sp(DIA, '14:00'));
    expect(await mensagensDe(id)).toEqual([
      { tipo: 'confirmacao', revisao: 0, estado: 'substituida' },
      { tipo: 'remarcacao', revisao: 1, estado: 'pendente' },
    ]);
    expect(fila.chaves()).toEqual([`${id}:remarcacao:1`]);
    expect(await db().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(1);
  });

  it('remarcar de novo gera revisão 2 e substitui a remarcação pendente anterior', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    await remarcar(c, id, { hora: '14:00' });
    await remarcar(c, id, { hora: '15:00' });
    expect(await mensagensDe(id)).toEqual([
      { tipo: 'confirmacao', revisao: 0, estado: 'substituida' },
      { tipo: 'remarcacao', revisao: 1, estado: 'substituida' },
      { tipo: 'remarcacao', revisao: 2, estado: 'pendente' },
    ]);
  });
});

describe('CA-2: horário ocupado', () => {
  it('horario_indisponivel (23P01): reserva, itens, revisão e mensagens intactos', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    await inserirReservaDireta(c, { inicio: sp(DIA, '14:00'), fim: sp(DIA, '14:30'), profissionalId: c.bia });
    const antes = { linha: await reservaDe(id), msgs: await mensagensDe(id), n: await contarLinhas(c.s.salaoId) };
    const fila = filaEspia();
    const r = await remarcar(c, id, { profissionalId: c.bia, hora: '14:15' }, { enfileirar: fila.enfileirar });
    expect(r).toEqual({ resultado: 'horario_indisponivel', causa: '23P01' });
    expect(await reservaDe(id)).toEqual(antes.linha);
    expect(await mensagensDe(id)).toEqual(antes.msgs);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes.n);
    expect(fila.total()).toBe(0);
  });
});

describe('CA-5: a própria posição não conflita', () => {
  it('10:00–10:30 → 10:15–10:45 do mesmo profissional', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    const r = await remarcar(c, id, { hora: '10:15' });
    expect(r.resultado).toBe('atualizada');
    const linha = await reservaDe(id);
    expect(linha.inicio).toEqual(sp(DIA, '10:15'));
    expect(linha.fim).toEqual(sp(DIA, '10:45'));
  });
});

describe('CA-3: cancelar', () => {
  it('cancelado, cancelada_em, horário volta à disponibilidade, cancelamento pendente e revisão intacta', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    const consulta = async () => {
      const r = await consultarDisponibilidade(c.ctxEquipe, { servicoIds: [c.A], profissionalId: c.ana, de: DIA, ate: DIA, agora: AGORA });
      if (r.resultado !== 'ok') throw new Error('consulta');
      return r.profissionais[0].dias[0].horarios.some((h) => h.inicio.getTime() === sp(DIA, '10:00').getTime());
    };
    expect(await consulta()).toBe(false);
    const fila = filaEspia();
    const r = await cancelarReserva(c.ctxEquipe, { reservaId: id }, AGORA, { enfileirar: fila.enfileirar });
    expect(r).toMatchObject({ resultado: 'atualizada', status: 'cancelado', revisao: 0 });
    const linha = await reservaDe(id);
    expect(linha).toMatchObject({ status: 'cancelado', revisao: 0 });
    expect(linha.canceladaEm).toEqual(AGORA);
    expect(await consulta()).toBe(true);
    expect(await mensagensDe(id)).toEqual([
      { tipo: 'confirmacao', revisao: 0, estado: 'substituida' },
      { tipo: 'cancelamento', revisao: 0, estado: 'pendente' },
    ]);
    expect(fila.chaves()).toEqual([`${id}:cancelamento:0`]);
  });

  it('repetir o cancelamento é recusado (reserva_final) sem segunda mensagem', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    await cancelarReserva(c.ctxEquipe, { reservaId: id }, AGORA);
    const fila = filaEspia();
    expect(await cancelarReserva(c.ctxEquipe, { reservaId: id }, AGORA, { enfileirar: fila.enfileirar })).toEqual({ resultado: 'recusado', motivo: 'reserva_final' });
    expect((await mensagensDe(id)).filter((m) => m.tipo === 'cancelamento')).toHaveLength(1);
    expect(fila.total()).toBe(0);
  });
});

describe('CA-4/CA-7: máquina de status no banco', () => {
  it('concluir/não compareceu antes do início: recusado, nada gravado; em agora == início: aceito', async () => {
    const c = await criarCenario();
    for (const para of ['concluido', 'nao_compareceu'] as const) {
      const id = await criarConfirmada(c, { hora: para === 'concluido' ? '10:00' : '12:00' });
      const antes = await mensagensDe(id);
      const inicio = (await reservaDe(id)).inicio;
      const r1 = await marcarStatusReserva(c.ctxEquipe, { reservaId: id, para }, new Date(inicio.getTime() - 1));
      expect(r1).toEqual({ resultado: 'recusado', motivo: 'ainda_nao_iniciada' });
      expect((await reservaDe(id)).status).toBe('confirmado');
      expect(await mensagensDe(id)).toEqual(antes);
      const r2 = await marcarStatusReserva(c.ctxEquipe, { reservaId: id, para }, inicio);
      expect(r2).toMatchObject({ resultado: 'atualizada', status: para });
      expect((await reservaDe(id)).status).toBe(para);
    }
  });

  it('cancelar: agora == fim recusa (ja_terminada) e fim − 1 ms aceita', async () => {
    const c = await criarCenario();
    const a = await criarConfirmada(c, { hora: '10:00' });
    const b = await criarConfirmada(c, { hora: '12:00' });
    const fimA = (await reservaDe(a)).fim;
    const fimB = (await reservaDe(b)).fim;
    expect(await cancelarReserva(c.ctxEquipe, { reservaId: a }, fimA)).toEqual({ resultado: 'recusado', motivo: 'ja_terminada' });
    expect((await reservaDe(a)).status).toBe('confirmado');
    expect((await cancelarReserva(c.ctxEquipe, { reservaId: b }, new Date(fimB.getTime() - 1))).resultado).toBe('atualizada');
  });

  it('concluido ↔ nao_compareceu nos dois sentidos; cancelado é final; destino inválido é recusado', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    const depois = sp(DIA, '12:00');
    const marcar = (para: unknown) => marcarStatusReserva(c.ctxEquipe, { reservaId: id, para }, depois);
    expect((await marcar('concluido')).resultado).toBe('atualizada');
    expect((await marcar('nao_compareceu')).resultado).toBe('atualizada');
    expect((await marcar('concluido')).resultado).toBe('atualizada');
    expect(await marcar('concluido')).toEqual({ resultado: 'recusado', motivo: 'transicao_invalida' });
    expect(await marcar('cancelado')).toEqual({ resultado: 'recusado', motivo: 'transicao_invalida' });
    expect(await marcar('confirmado')).toEqual({ resultado: 'recusado', motivo: 'transicao_invalida' });
    expect(await cancelarReserva(c.ctxEquipe, { reservaId: id }, AGORA)).toEqual({ resultado: 'recusado', motivo: 'transicao_invalida' });
    const cancelada = await criarConfirmada(c, { hora: '15:00' });
    await cancelarReserva(c.ctxEquipe, { reservaId: cancelada }, AGORA);
    expect(await marcarStatusReserva(c.ctxEquipe, { reservaId: cancelada, para: 'concluido' }, depois)).toEqual({ resultado: 'recusado', motivo: 'reserva_final' });
    expect(await remarcar(c, cancelada)).toEqual({ resultado: 'recusado', motivo: 'reserva_final' });
  });

  it('remarcar só confirmado: concluida é recusada', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    await marcarStatusReserva(c.ctxEquipe, { reservaId: id, para: 'concluido' }, sp(DIA, '12:00'));
    expect(await remarcar(c, id, {}, {}, sp(DIA, '12:00'))).toEqual({ resultado: 'recusado', motivo: 'transicao_invalida' });
  });
});

describe('CA-6/CA-14: papéis e isolamento', () => {
  it('profissional em reserva de outra profissional: AcessoNegado nas três operações, nada muda', async () => {
    const c = await criarCenario();
    const daBia = await criarConfirmada(c, { profissionalId: c.bia });
    const ana = ctxProfissional(c);
    const antes = await reservaDe(daBia);
    await expect(remarcarReserva(ana, { reservaId: daBia, data: '2026-12-01', hora: '14:00', profissionalId: c.bia, servicoIds: [c.A] }, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(cancelarReserva(ana, { reservaId: daBia }, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(marcarStatusReserva(ana, { reservaId: daBia, para: 'concluido' }, sp(DIA, '12:00'))).rejects.toBeInstanceOf(AcessoNegado);
    expect(await reservaDe(daBia)).toEqual(antes);
  });

  it('profissional remarca a própria; para outro profissional: AcessoNegado', async () => {
    const c = await criarCenario();
    const propria = await criarConfirmada(c);
    const ana = ctxProfissional(c);
    const base = { reservaId: propria, data: '2026-12-01', hora: '14:00', servicoIds: [c.A] };
    await expect(remarcarReserva(ana, { ...base, profissionalId: c.bia }, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    expect((await reservaDe(propria)).profissionalId).toBe(c.ana);
    const ok = await remarcarReserva(ana, { ...base, profissionalId: c.ana }, AGORA, { enfileirar: filaEspia().enfileirar });
    expect(ok.resultado).toBe('atualizada');
  });

  it('reserva de outro salão, inexistente ou id malformado: NaoEncontrado igual, nada alterado', async () => {
    const c = await criarCenario();
    const outro = await criarCenario();
    const alheia = await criarConfirmada(outro);
    const antes = await reservaDe(alheia);
    const antesMsgs = await mensagensDe(alheia);
    for (const id of [alheia, randomUUID(), 'abc', 42, null]) {
      await expect(remarcarReserva(c.ctxEquipe, { reservaId: id, data: '2026-12-01', hora: '14:00', profissionalId: c.ana, servicoIds: [c.A] }, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(cancelarReserva(c.ctxEquipe, { reservaId: id }, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(marcarStatusReserva(c.ctxEquipe, { reservaId: id, para: 'concluido' }, sp(DIA, '12:00'))).rejects.toBeInstanceOf(NaoEncontrado);
    }
    expect(await reservaDe(alheia)).toEqual(antes);
    expect(await mensagensDe(alheia)).toEqual(antesMsgs);
  });

  it('profissional de outro salão como destino: profissional_indisponivel; outro salão nunca é tocado', async () => {
    const c = await criarCenario();
    const outro = await criarSalaoCompleto();
    const id = await criarConfirmada(c);
    const r = await remarcar(c, id, { profissionalId: outro.profissional.profissionalId });
    expect(r).toEqual({ resultado: 'profissional_indisponivel' });
    expect((await reservaDe(id)).profissionalId).toBe(c.ana);
  });
});

describe('CA-8: itens e snapshot', () => {
  it('mantém o snapshot dos serviços inalterados, usa o cadastro atual nos acrescentados e ocupado_ate = fim + intervalo', async () => {
    const c = await criarCenario({ intervaloMin: 10 });
    const id = await criarConfirmada(c);
    await db().servico.update({ where: { id: c.A }, data: { precoCentavos: 9900, duracaoMin: 60 } });
    await db().servico.update({ where: { id: c.B }, data: { precoCentavos: 8800 } });
    const r = await remarcar(c, id, { servicoIds: [c.A, c.B], hora: '11:00' });
    expect(r.resultado).toBe('atualizada');
    const linha = await reservaDe(id);
    expect(linha.itens.map((i) => [i.servicoId, i.ordem, i.precoCentavos, i.duracaoMin])).toEqual([
      [c.A, 0, 5000, 30],
      [c.B, 1, 8800, 45],
    ]);
    expect(linha.inicio).toEqual(sp(DIA, '11:00'));
    expect(linha.fim).toEqual(sp(DIA, '12:15'));
    expect(linha.ocupadoAte).toEqual(sp(DIA, '12:25'));
  });

  it('remove serviços (só B fica) e reordena', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c, { servicoIds: [c.A, c.B] });
    const r = await remarcar(c, id, { servicoIds: [c.B] });
    expect(r.resultado).toBe('atualizada');
    expect((await reservaDe(id)).itens.map((i) => [i.servicoId, i.ordem])).toEqual([[c.B, 0]]);
  });

  it('mesmos início, profissional e serviços: sem_alteracao, nada gravado', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    const antes = { l: await reservaDe(id), m: await mensagensDe(id) };
    const fila = filaEspia();
    expect(await remarcar(c, id, { hora: '10:00' }, { enfileirar: fila.enfileirar })).toEqual({ resultado: 'recusado', motivo: 'sem_alteracao' });
    expect(await reservaDe(id)).toEqual(antes.l);
    expect(await mensagensDe(id)).toEqual(antes.m);
    expect(fila.total()).toBe(0);
  });

  it('profissional que não faz todos os serviços: profissional_indisponivel; serviço inativo acrescentado: servico_indisponivel', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    expect(await remarcar(c, id, { profissionalId: c.bia, servicoIds: [c.A, c.B] })).toEqual({ resultado: 'profissional_indisponivel' });
    await db().servico.update({ where: { id: c.B }, data: { ativo: false } });
    expect(await remarcar(c, id, { servicoIds: [c.A, c.B] })).toEqual({ resultado: 'servico_indisponivel' });
    expect(await remarcar(c, id, { servicoIds: [randomUUID()] })).toEqual({ resultado: 'servico_indisponivel' });
    await db().profissional.update({ where: { id: c.bia }, data: { ativo: false } });
    expect(await remarcar(c, id, { profissionalId: c.bia })).toEqual({ resultado: 'profissional_indisponivel' });
    expect((await reservaDe(id)).revisao).toBe(0);
  });

  it('entrada inválida: data, hora, serviços e início no passado', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    expect(await remarcar(c, id, { data: '2026-02-31' })).toMatchObject({ resultado: 'invalido', erros: { inicio: expect.any(String) } });
    expect(await remarcar(c, id, { hora: '25:00' })).toMatchObject({ resultado: 'invalido' });
    expect(await remarcar(c, id, { servicoIds: [] })).toMatchObject({ resultado: 'invalido', erros: { servicos: expect.any(String) } });
    expect(await remarcar(c, id, { servicoIds: [c.A, c.A] })).toMatchObject({ resultado: 'invalido' });
    expect(await remarcar(c, id, { servicoIds: 'x' })).toMatchObject({ resultado: 'invalido' });
    expect(await remarcar(c, id, { data: '2026-11-19' })).toMatchObject({ resultado: 'invalido', erros: { inicio: expect.any(String) } });
    expect(await remarcar(c, id, { profissionalId: 'xyz' })).toEqual({ resultado: 'profissional_indisponivel' });
    expect(await remarcar(c, id, { servicoIds: ['xyz'] })).toEqual({ resultado: 'servico_indisponivel' });
    expect((await reservaDe(id)).revisao).toBe(0);
  });
});

describe('CA-9: encaixe', () => {
  it('fora da jornada exige confirmação; confirmando grava encaixe=true; sem sobreposição mesmo assim', async () => {
    const c = await criarCenario({ jornada: [['09:00', '18:00']] });
    const id = await criarConfirmada(c);
    const antes = await reservaDe(id);
    const r1 = await remarcar(c, id, { hora: '18:30' });
    expect(r1).toEqual({ resultado: 'encaixe_requer_confirmacao', motivos: ['fora_da_jornada'] });
    expect(await reservaDe(id)).toEqual(antes);
    const r2 = await remarcar(c, id, { hora: '18:30', confirmarEncaixe: 'on' });
    expect(r2).toMatchObject({ resultado: 'atualizada', reserva: { encaixe: true } });
    expect((await reservaDe(id)).encaixe).toBe(true);
    // voltar ao horário normal recalcula o encaixe
    const r3 = await remarcar(c, id, { hora: '11:00' });
    expect(r3).toMatchObject({ resultado: 'atualizada', reserva: { encaixe: false } });
    // sobreposição é sempre recusada, mesmo confirmando
    await inserirReservaDireta(c, { inicio: sp(DIA, '19:00'), fim: sp(DIA, '19:30') });
    expect(await remarcar(c, id, { hora: '19:15', confirmarEncaixe: true })).toEqual({ resultado: 'horario_indisponivel', causa: '23P01' });
  });
});

describe('CA-10: cliente anonimizada', () => {
  async function anonimizar(id: string) {
    const r = await reservaDe(id);
    await db().cliente.update({ where: { id: r.clienteId }, data: { nome: null, telefoneE164: null, anonimizadaEm: AGORA } });
  }

  it('cancelar, remarcar e concluir funcionam; mensagens cancelada_anonimizacao e nenhum job', async () => {
    const c = await criarCenario();
    const fila = filaEspia();
    const a = await criarConfirmada(c, { hora: '10:00' });
    const b = await criarConfirmada(c, { hora: '12:00' });
    const d = await criarConfirmada(c, { hora: '15:00' });
    for (const id of [a, b, d]) await anonimizar(id);
    expect((await cancelarReserva(c.ctxEquipe, { reservaId: a }, AGORA, { enfileirar: fila.enfileirar })).resultado).toBe('atualizada');
    expect((await remarcar(c, b, { hora: '13:00' }, { enfileirar: fila.enfileirar })).resultado).toBe('atualizada');
    expect((await marcarStatusReserva(c.ctxEquipe, { reservaId: d, para: 'concluido' }, sp(DIA, '16:00'), { enfileirar: fila.enfileirar })).resultado).toBe('atualizada');
    expect((await mensagensDe(a)).at(-1)).toEqual({ tipo: 'cancelamento', revisao: 0, estado: 'cancelada_anonimizacao' });
    expect((await mensagensDe(b)).at(-1)).toEqual({ tipo: 'remarcacao', revisao: 1, estado: 'cancelada_anonimizacao' });
    expect((await mensagensDe(d)).at(-1)).toEqual({ tipo: 'convite_avaliacao', revisao: 0, estado: 'cancelada_anonimizacao' });
    expect(fila.total()).toBe(0);
  });
});

describe('CA-11/CA-R3: atomicidade e falha da fila', () => {
  it('se a fila falha depois do commit, a reserva permanece e loga mensagem.fila_indisponivel', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    const linhas: string[] = [];
    const falha = vi.fn(async () => {
      throw new Error('fila fora do ar');
    });
    const r = await cancelarReserva(c.ctxEquipe, { reservaId: id }, AGORA, { enfileirar: falha as never });
    expect(r.resultado).toBe('atualizada');
    expect((await reservaDe(id)).status).toBe('cancelado');
    expect((await mensagensDe(id)).at(-1)).toEqual({ tipo: 'cancelamento', revisao: 0, estado: 'pendente' });
    expect(falha).toHaveBeenCalledTimes(1);
    const logs = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((x) => String(x[0]));
    linhas.push(...logs);
    expect(linhas.some((l) => l.includes('mensagem.fila_indisponivel'))).toBe(true);
    for (const l of linhas) expect(l).not.toContain('fila fora do ar');
  });

  it('se a mensagem não é gravada, o status e a posição não mudam (tudo ou nada)', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    const antes = await reservaDe(id);
    const { conectar } = await import('../../../support/sql');
    const { instalarFalhaPorTrigger } = await import('../../../support/reservas');
    const cx = await conectar();
    try {
      const remover = await instalarFalhaPorTrigger(cx, 'mensagem');
      try {
        await expect(cancelarReserva(c.ctxEquipe, { reservaId: id }, AGORA)).rejects.toThrow();
        await expect(remarcar(c, id, { hora: '14:00' })).rejects.toThrow();
      } finally {
        await remover();
      }
    } finally {
      await cx.end();
    }
    expect(await reservaDe(id)).toEqual(antes);
  });
});

describe('CA-R1/CA-R2: convite de avaliação', () => {
  it('concluir com consentimento: um convite revisão 0 pendente, enfileirado após o commit; sem consentimento: nao_enviada, sem job', async () => {
    const c = await criarCenario();
    const com = await criarConfirmada(c, { hora: '10:00' });
    const sem = await criarConfirmada(c, { hora: '12:00' });
    await consentirConvite(com);
    const fila = filaEspia();
    const depois = sp(DIA, '16:00');
    await marcarStatusReserva(c.ctxEquipe, { reservaId: com, para: 'concluido' }, depois, { enfileirar: fila.enfileirar });
    await marcarStatusReserva(c.ctxEquipe, { reservaId: sem, para: 'concluido' }, depois, { enfileirar: fila.enfileirar });
    expect((await mensagensDe(com)).filter((m) => m.tipo === 'convite_avaliacao')).toEqual([{ tipo: 'convite_avaliacao', revisao: 0, estado: 'pendente' }]);
    expect((await mensagensDe(sem)).filter((m) => m.tipo === 'convite_avaliacao')).toEqual([{ tipo: 'convite_avaliacao', revisao: 0, estado: 'nao_enviada' }]);
    expect(fila.chaves()).toEqual([`${com}:convite_avaliacao:0`]);
  });

  it('concluido → nao_compareceu substitui só o convite pendente; a volta não cria nem reenfileira', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    await consentirConvite(id);
    const depois = sp(DIA, '16:00');
    const fila = filaEspia();
    const marcar = (para: 'concluido' | 'nao_compareceu') => marcarStatusReserva(c.ctxEquipe, { reservaId: id, para }, depois, { enfileirar: fila.enfileirar });
    await marcar('concluido');
    await marcar('nao_compareceu');
    const convites = () => db().mensagem.findMany({ where: { reservaId: id, tipo: 'convite_avaliacao' }, select: { estado: true } });
    expect(await convites()).toEqual([{ estado: 'substituida' }]);
    await marcar('concluido');
    expect(await convites()).toEqual([{ estado: 'substituida' }]);
    expect(fila.total()).toBe(1);
  });

  it('convite já enviado não muda ao marcar não compareceu', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    await consentirConvite(id);
    const depois = sp(DIA, '16:00');
    await marcarStatusReserva(c.ctxEquipe, { reservaId: id, para: 'concluido' }, depois, { enfileirar: filaEspia().enfileirar });
    await db().mensagem.updateMany({ where: { reservaId: id, tipo: 'convite_avaliacao' }, data: { estado: 'enviada' } });
    await marcarStatusReserva(c.ctxEquipe, { reservaId: id, para: 'nao_compareceu' }, depois);
    expect((await mensagensDe(id)).filter((m) => m.tipo === 'convite_avaliacao')).toEqual([{ tipo: 'convite_avaliacao', revisao: 0, estado: 'enviada' }]);
  });
});

describe('CA-12: política (gancho da E6.4)', () => {
  it('negando, as três operações lançam AcessoNegado e nada é gravado', async () => {
    const c = await criarCenario();
    const id = await criarConfirmada(c);
    const antes = { l: await reservaDe(id), m: await mensagensDe(id) };
    const politica = vi.fn(() => ({ permitido: false as const, motivo: 'salão suspenso' }));
    await expect(remarcar(c, id, {}, { politica })).rejects.toBeInstanceOf(AcessoNegado);
    await expect(cancelarReserva(c.ctxEquipe, { reservaId: id }, AGORA, { politica })).rejects.toBeInstanceOf(AcessoNegado);
    await expect(marcarStatusReserva(c.ctxEquipe, { reservaId: id, para: 'concluido' }, sp(DIA, '12:00'), { politica })).rejects.toBeInstanceOf(AcessoNegado);
    expect(politica.mock.calls.map((x) => (x as unknown[])[1])).toEqual(['agendar', 'cancelar', 'cancelar']);
    expect(await reservaDe(id)).toEqual(antes.l);
    expect(await mensagensDe(id)).toEqual(antes.m);
  });
});
