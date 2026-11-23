import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { obter } from '@/server/clientes/servico';
import { NaoEncontrado } from '@/server/tenant/erros';

import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import { conectar, inserirReserva } from '../../support/sql';

import { MANAUS, SP, UUID_INEXISTENTE, ctxDoGestor, ctxDoProfissional, inserirCliente, inserirReservaComPreco } from './apoio';

// D-022 T-5: CA-13 (histórico no fuso do salão, snapshots, 50 de N), CA-4 (só o histórico do salão) e CA-7
// (anonimizada). Resultado independe do fuso do processo (TZ=UTC e America/Sao_Paulo).

let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

describe('CA-13: histórico no fuso do salão, com snapshots', () => {
  it('três reservas da mais recente à mais antiga; status pt-BR; serviços na ordem; totais do snapshot mesmo com o preço alterado', async () => {
    const s = await criarSalaoCompleto({ cliente: { nome: 'Helena', telefoneE164: '+5511977770001' }, reserva: { inicio: new Date('2031-01-01T13:00:00Z') } });
    const [s1, s2] = s.servicos.ativos;
    const base = { salaoId: s.salaoId, profissionalId: s.profissional.profissionalId, clienteId: s.clientes.ativaId };
    // Remove a reserva da fábrica para o histórico ter só as três do teste.
    await c.query('DELETE FROM reserva_item WHERE reserva_id = $1', [s.reserva.id]);
    await c.query('DELETE FROM reserva WHERE id = $1', [s.reserva.id]);
    await inserirReservaComPreco(c, { ...base, inicio: new Date('2027-05-10T13:00:00Z'), status: 'cancelado', itens: [{ servicoId: s1, precoCentavos: 9000, duracaoMin: 60 }] });
    await inserirReservaComPreco(c, { ...base, inicio: new Date('2027-06-11T17:30:00Z'), status: 'concluido', itens: [{ servicoId: s2, precoCentavos: 5500, duracaoMin: 30 }, { servicoId: s1, precoCentavos: 12345, duracaoMin: 75 }] });
    // 02:30 UTC de 13/07 = 23:30 de 12/07 em São Paulo (virada de dia).
    await inserirReservaComPreco(c, { ...base, inicio: new Date('2027-07-13T02:30:00Z'), status: 'confirmado', itens: [{ servicoId: s1, precoCentavos: 1999, duracaoMin: 45 }] });
    // O preço e a duração atuais do serviço mudam depois: o histórico usa o snapshot.
    await c.query('UPDATE servico SET preco_centavos = 99999, duracao_min = 5 WHERE id = ANY($1)', [[s1, s2]]);

    const d = await obter(ctxDoGestor(s), s.clientes.ativaId);
    expect(d.totalReservas).toBe(3);
    expect(d.cliente).toMatchObject({ nome: 'Helena', telefoneFormatado: '(11) 97777-0001', anonimizada: false });
    expect(d.historico.map((h) => [h.inicioLocal, h.status, h.precoTotal, h.totalDaCancelada])).toEqual([
      ['12/07/2027 23:30', 'Confirmado', 'R$\u00a019,99', false],
      ['11/06/2027 14:30', 'Concluído', 'R$\u00a0178,45', false],
      // RN-35: reserva toda cancelada soma todos os itens, com o rótulo de cancelada.
      ['10/05/2027 10:00', 'Cancelado', 'R$\u00a090,00', true],
    ]);
    expect(d.historico[1].servicos.map((x) => [x.servico, x.horaLocal, x.preco])).toEqual([
      [s.servicos.nomes[1], '14:30', 'R$\u00a055,00'],
      [s.servicos.nomes[0], '15:00', 'R$\u00a0123,45'],
    ]);
    expect(d.historico.every((h) => h.servicos.every((x) => x.profissional === s.profissional.nome))).toBe(true);
  });

  it('o mesmo instante UTC em America/Manaus mostra outra hora; "não compareceu" tem rótulo', async () => {
    const m = await criarSalaoCompleto({ salao: { fuso: MANAUS } });
    const sp = await criarSalaoCompleto({ salao: { fuso: SP } });
    const instante = new Date('2027-08-20T13:00:00Z');
    for (const [s, esperado] of [[m, '20/08/2027 09:00'], [sp, '20/08/2027 10:00']] as const) {
      await inserirReservaComPreco(c, {
        salaoId: s.salaoId,
        profissionalId: s.profissional.profissionalId,
        clienteId: s.clientes.ativaId,
        inicio: instante,
        status: 'nao_compareceu',
        itens: [{ servicoId: s.servicos.ativos[0], precoCentavos: 5000, duracaoMin: 30 }],
      });
      const d = await obter(ctxDoGestor(s), s.clientes.ativaId);
      const h = d.historico.find((x) => x.status === 'Não compareceu');
      expect(h?.inicioLocal).toBe(esperado);
    }
  });

  it('profissional e serviço inativos continuam exibidos', async () => {
    const s = await criarSalaoCompleto();
    const cl = await inserirCliente(c, s.salaoId, 'Inativos');
    await inserirReservaComPreco(c, {
      salaoId: s.salaoId,
      profissionalId: s.profissionalInativoId,
      clienteId: cl,
      inicio: new Date('2027-09-01T13:00:00Z'),
      status: 'concluido',
      itens: [{ servicoId: s.servicos.inativoId, precoCentavos: 18000, duracaoMin: 120 }],
    });
    const d = await obter(ctxDoGestor(s), cl);
    expect(d.historico).toHaveLength(1);
    expect(d.historico[0].servicos.map((x) => x.servico)).toEqual(['Coloração (descontinuada)']);
    expect(d.historico[0].servicos[0].profissional.length).toBeGreaterThan(0);
  });

  it('sem reservas: histórico vazio e total 0', async () => {
    const s = await criarSalaoCompleto();
    const cl = await inserirCliente(c, s.salaoId, 'Sem Reservas');
    expect(await obter(ctxDoGestor(s), cl)).toMatchObject({ historico: [], totalReservas: 0 });
  });

  it('60 reservas: mostra as 50 mais recentes e o total 60', async () => {
    const s = await criarSalaoCompleto();
    const cl = await inserirCliente(c, s.salaoId, 'Muitas');
    const servicoId = s.servicos.ativos[0];
    for (let g = 1; g <= 60; g++) {
      const inicio = new Date(Date.UTC(2027, 0, 1 + g, 10, 0));
      await inserirReserva(c, {
        salaoId: s.salaoId,
        profissionalId: s.profissional.profissionalId,
        clienteId: cl,
        inicio,
        fim: new Date(inicio.getTime() + 30 * 60_000),
        status: 'cancelado',
        servicoId,
      });
    }
    const d = await obter(ctxDoGestor(s), cl);
    expect(d.totalReservas).toBe(60);
    expect(d.historico).toHaveLength(50);
    // As mais recentes primeiro: a 60ª (02/03/2027) abre a lista.
    expect(d.historico[0].inicioLocal).toBe('02/03/2027 07:00');
    expect(d.historico[0].servicos).toHaveLength(1);
    expect(d.historico[0]).toMatchObject({ status: 'Cancelado', totalDaCancelada: true });
  });
});

describe('D-050 RN-35: reserva com itens de profissionais e status diferentes', () => {
  it('cada item com seu profissional, hora e status; cancelado listado com preço; total só dos não cancelados', async () => {
    const s = await criarSalaoCompleto({ salao: { fuso: SP } });
    const cl = await inserirCliente(c, s.salaoId, 'Itens');
    const [s1, s2] = s.servicos.ativos;
    await inserirReservaComPreco(c, {
      salaoId: s.salaoId,
      profissionalId: s.profissional.profissionalId,
      clienteId: cl,
      inicio: new Date('2027-10-05T12:00:00Z'),
      status: 'confirmado',
      itens: [
        { servicoId: s1, precoCentavos: 8000, duracaoMin: 60 },
        { servicoId: s2, precoCentavos: 6500, duracaoMin: 30, profissionalId: s.gestor.profissionalId!, status: 'cancelado' },
      ],
    });
    const [h] = (await obter(ctxDoGestor(s), cl)).historico;
    expect(h).toMatchObject({ inicioLocal: '05/10/2027 09:00', status: 'Confirmado', precoTotal: 'R$\u00a080,00', totalDaCancelada: false });
    expect(h.servicos).toEqual([
      { servico: s.servicos.nomes[0], profissional: s.profissional.nome, horaLocal: '09:00', status: 'Confirmado', cancelado: false, preco: 'R$\u00a080,00' },
      { servico: s.servicos.nomes[1], profissional: s.gestor.nome, horaLocal: '10:00', status: 'Cancelado', cancelado: true, preco: 'R$\u00a065,00' },
    ]);
  });

  it('status derivado: um item concluído e outro não compareceu → "Concluído", total dos dois', async () => {
    const s = await criarSalaoCompleto({ salao: { fuso: SP } });
    const cl = await inserirCliente(c, s.salaoId, 'Derivado');
    const [s1, s2] = s.servicos.ativos;
    await inserirReservaComPreco(c, {
      salaoId: s.salaoId,
      profissionalId: s.profissional.profissionalId,
      clienteId: cl,
      inicio: new Date('2027-10-06T12:00:00Z'),
      status: 'concluido',
      itens: [
        { servicoId: s1, precoCentavos: 1000, duracaoMin: 30 },
        { servicoId: s2, precoCentavos: 2000, duracaoMin: 30, status: 'nao_compareceu' },
      ],
    });
    const [h] = (await obter(ctxDoGestor(s), cl)).historico;
    expect(h).toMatchObject({ status: 'Concluído', precoTotal: 'R$\u00a030,00' });
    expect(h.servicos.map((x) => x.status)).toEqual(['Concluído', 'Não compareceu']);
  });
});

describe('CA-4 / CA-7: escopo e anonimizada', () => {
  it('o histórico traz só as reservas do salão; cliente de outro salão → NaoEncontrado', async () => {
    const { a, b } = await criarDoisSaloes();
    const da = await obter(ctxDoGestor(a), a.clientes.ativaId);
    expect(da.historico.map((h) => h.id)).toEqual([a.reserva.id]);
    const db = await obter(ctxDoGestor(b), b.clientes.ativaId);
    expect(db.historico.map((h) => h.id)).toEqual([b.reserva.id]);
    await expect(obter(ctxDoGestor(a), b.clientes.ativaId)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(obter(ctxDoGestor(a), UUID_INEXISTENTE)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(obter(ctxDoGestor(a), 'nao-uuid')).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(obter(ctxDoProfissional(a), a.clientes.ativaId)).rejects.toThrow();
  });

  it('anonimizada: detalhe somente leitura com nome/telefone nulos e o histórico preservado', async () => {
    const s = await criarSalaoCompleto();
    await inserirReservaComPreco(c, {
      salaoId: s.salaoId,
      profissionalId: s.profissional.profissionalId,
      clienteId: s.clientes.anonimizadaId,
      inicio: new Date('2027-04-01T13:00:00Z'),
      status: 'concluido',
      itens: [{ servicoId: s.servicos.ativos[1], precoCentavos: 5500, duracaoMin: 30 }],
    });
    const d = await obter(ctxDoGestor(s), s.clientes.anonimizadaId);
    expect(d.cliente).toEqual({ id: s.clientes.anonimizadaId, nome: null, telefone: null, telefoneFormatado: null, anonimizada: true });
    expect(d.totalReservas).toBe(1);
    expect(d.historico[0]).toMatchObject({ status: 'Concluído', precoTotal: 'R$\u00a055,00' });
  });
});
