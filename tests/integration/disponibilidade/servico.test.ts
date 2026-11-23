import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultarDisponibilidadePorServico } from '@/server/disponibilidade/servico';
import type { EntradaDisponibilidadePorServico } from '@/server/disponibilidade/tipos';
import { NaoEncontrado } from '@/server/tenant/erros';

import { conectar } from '../../support/sql';

import {
  AGORA, DIA, DIA_SEGUINTE, MANAUS, TODOS_OS_DIAS, criarCenario, ctxPublico, definirFuncionamento, definirRegras,
  faixa, inserirBloqueio, inserirCliente, inserirJornada, inserirReserva, marcarFuncionamentoNaoInformado,
  profissionaisDe, rotulos, sp, UUID_INEXISTENTE,
} from './apoio';
import type { Cenario } from './apoio';

// D-018 T-4, reescrito na D-050 (T-3): serviço de disponibilidade POR SERVIÇO contra PostgreSQL real
// (regras da D-018 por serviço). Relógio injetado (AGORA); cada cenário nasce de criarCenario (A 30 min
// R$ 50, B 45 min R$ 80, Ana em A e B, Bia só em A). Restringir a um profissional = profissionalPorServico.

let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

const consultar = (x: Cenario, parcial: Partial<EntradaDisponibilidadePorServico> = {}) =>
  consultarDisponibilidadePorServico(ctxPublico(x.s), { servicoIds: [x.A], de: DIA, ate: DIA, agora: AGORA, ...parcial });

/** Restringe todos os serviços pedidos ao profissional (a antiga entrada `profissionalId`). */
const so = (profissionalId: string, servicoIds: string[]): Partial<EntradaDisponibilidadePorServico> => ({
  servicoIds,
  profissionalPorServico: Object.fromEntries(servicoIds.map((id) => [id, profissionalId])),
});

const comJornadaDaAna = async (...faixas: [string, string][]) => {
  const x = await criarCenario(c);
  await inserirJornada(c, x.s.salaoId, x.ana, TODOS_OS_DIAS, ...faixas);
  return x;
};

describe('elegibilidade por serviço (RN-7, CA-11, CA-23)', () => {
  it('A → Ana e Bia, nessa ordem (nome, id); B → só Ana', async () => {
    const x = await criarCenario(c);
    const r = await consultar(x, { servicoIds: [x.A, x.B] });
    expect(profissionaisDe(r, x.A)).toEqual([x.ana, x.bia]);
    expect(profissionaisDe(r, x.B)).toEqual([x.ana]);
    if (r.resultado !== 'ok') throw new Error();
    expect(r.servicos[0].profissionais.map((p) => p.nome)).toEqual(['Ana', 'Bia']);
  });

  it('cada serviço com a própria duração e preço, na ordem pedida; intervaloMin e fuso no resultado', async () => {
    const x = await comJornadaDaAna(['09:00', '12:00']);
    const r = await consultar(x, { servicoIds: [x.B, x.A] });
    expect(r).toMatchObject({ resultado: 'ok', fuso: 'America/Sao_Paulo', intervaloMin: 0 });
    if (r.resultado !== 'ok') throw new Error();
    expect(r.servicos.map(({ servicoId, nome, duracaoMin, precoCentavos, vazioPorConflito }) => ({ servicoId, nome, duracaoMin, precoCentavos, vazioPorConflito }))).toEqual([
      { servicoId: x.B, nome: 'B', duracaoMin: 45, precoCentavos: 8000, vazioPorConflito: false },
      { servicoId: x.A, nome: 'A', duracaoMin: 30, precoCentavos: 5000, vazioPorConflito: false },
    ]);
    expect(rotulos(r, 0, 0, 0)).toEqual(faixa('09:00', '11:15'));
    expect(rotulos(r, 0, 0, 1)).toEqual(faixa('09:00', '11:30'));
    expect(r.servicos[1].profissionais[0].dias[0].horarios[0].fim.toISOString()).toBe('2026-12-01T12:30:00.000Z');
  });

  it('serviço B desativado → servico_indisponivel, sem horários', async () => {
    const x = await comJornadaDaAna(['09:00', '12:00']);
    await c.query('UPDATE servico SET ativo = false WHERE id = $1', [x.B]);
    expect(await consultar(x, { servicoIds: [x.A, x.B] })).toEqual({ resultado: 'servico_indisponivel' });
  });

  it('Ana desativada: A só com Bia; restrita à Ana → sem profissionais; B sem profissional ativo fica indisponível', async () => {
    const x = await comJornadaDaAna(['09:00', '12:00']);
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [x.ana]);
    expect(profissionaisDe(await consultar(x), x.A)).toEqual([x.bia]);
    expect(await consultar(x, so(x.ana, [x.A]))).toMatchObject({ resultado: 'ok', servicos: [{ servicoId: x.A, profissionais: [] }] });
    expect(await consultar(x, { servicoIds: [x.A, x.B] })).toEqual({ resultado: 'servico_indisponivel' });
  });

  it('CA-23: restrição por serviço; Bia sem o serviço B → B vazio, sem erro', async () => {
    const x = await criarCenario(c);
    await inserirJornada(c, x.s.salaoId, x.ana, TODOS_OS_DIAS, ['09:00', '10:00']);
    await inserirJornada(c, x.s.salaoId, x.bia, TODOS_OS_DIAS, ['10:00', '11:00']);
    const todos = await consultar(x);
    expect(rotulos(todos, 0)).toEqual(['09:00', '09:15', '09:30']);
    expect(rotulos(todos, 1)).toEqual(['10:00', '10:15', '10:30']);
    expect(profissionaisDe(await consultar(x, so(x.bia, [x.A])), x.A)).toEqual([x.bia]);
    const misto = await consultar(x, { servicoIds: [x.A, x.B], profissionalPorServico: { [x.A]: x.bia, [x.B]: x.bia } });
    expect(profissionaisDe(misto, x.A)).toEqual([x.bia]);
    expect(profissionaisDe(misto, x.B)).toEqual([]);
    const cruzado = await consultar(x, { servicoIds: [x.A, x.B], profissionalPorServico: { [x.A]: x.bia, [x.B]: x.ana } });
    expect(profissionaisDe(cruzado, x.A)).toEqual([x.bia]);
    expect(profissionaisDe(cruzado, x.B)).toEqual([x.ana]);
  });

  it('profissional da restrição malformado ou inexistente → NaoEncontrado; id em maiúsculas é aceito', async () => {
    const x = await comJornadaDaAna(['09:00', '10:00']);
    await expect(consultar(x, so('nao-uuid', [x.A]))).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(consultar(x, so(UUID_INEXISTENTE, [x.A]))).rejects.toBeInstanceOf(NaoEncontrado);
    expect(rotulos(await consultar(x, so(x.ana.toUpperCase(), [x.A])))).toEqual(['09:00', '09:15', '09:30']);
  });
});

describe('regras do cálculo com o banco (CA-3, CA-5, CA-9, CA-12, CA-19)', () => {
  it('CA-3: intervalo 15 e reserva 10:00–10:30 com ocupado_ate 10:45', async () => {
    const x = await comJornadaDaAna(['09:00', '12:00']);
    await definirRegras(c, x.s.salaoId, { intervalo_min: 15 });
    const cli = await inserirCliente(c, x.s.salaoId);
    await inserirReserva(c, { salaoId: x.s.salaoId, profissionalId: x.ana, clienteId: cli, inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30'), ocupadoAte: sp(DIA, '10:45') });
    const i = rotulos(await consultar(x, so(x.ana, [x.A])));
    expect(i).not.toContain('09:30');
    expect(i).not.toContain('10:30');
    expect(i).toContain('09:15');
    expect(i).toContain('10:45');
  });

  it('CA-3: intervalo 0 e ocupado_ate 10:30 → 09:30 e 10:30 oferecidos', async () => {
    const x = await comJornadaDaAna(['09:00', '12:00']);
    const cli = await inserirCliente(c, x.s.salaoId);
    await inserirReserva(c, { salaoId: x.s.salaoId, profissionalId: x.ana, clienteId: cli, inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') });
    const i = rotulos(await consultar(x, so(x.ana, [x.A])));
    expect(i).toContain('09:30');
    expect(i).toContain('10:30');
    expect(i).not.toContain('10:00');
  });

  it('CA-5: bloqueio de salão de dia inteiro em 25/12 → ninguém; 24 e 26 têm horários', async () => {
    const x = await criarCenario(c);
    await inserirJornada(c, x.s.salaoId, x.ana, TODOS_OS_DIAS, ['09:00', '12:00']);
    await inserirJornada(c, x.s.salaoId, x.bia, TODOS_OS_DIAS, ['09:00', '12:00']);
    await inserirBloqueio(c, x.s.salaoId, null, new Date('2026-12-25T03:00:00Z'), new Date('2026-12-26T03:00:00Z'), 'Natal');
    const r = await consultar(x, { de: { ano: 2026, mes: 12, dia: 24 }, ate: { ano: 2026, mes: 12, dia: 26 } });
    expect(rotulos(r, 0, 0).length).toBeGreaterThan(0);
    expect(rotulos(r, 0, 1)).toEqual([]);
    expect(rotulos(r, 1, 1)).toEqual([]);
    expect(rotulos(r, 0, 2).length).toBeGreaterThan(0);
    expect(rotulos(r, 1, 2).length).toBeGreaterThan(0);
  });

  it('CA-9: grade 30 e jornada 09:05–12:00 → primeiro início 09:30 e todos múltiplos de 30', async () => {
    const x = await comJornadaDaAna(['09:05', '12:00']);
    await definirRegras(c, x.s.salaoId, { grade_min: 15 });
    expect(rotulos(await consultar(x, so(x.ana, [x.A])))[0]).toBe('09:15');
    await definirRegras(c, x.s.salaoId, { grade_min: 30 });
    const r = await consultar(x, so(x.ana, [x.A]));
    const i = rotulos(r);
    expect(i[0]).toBe('09:30');
    expect(i.every((h) => Number(h.slice(3)) % 30 === 0)).toBe(true);
  });

  it('CA-12: cancelada libera; concluída, não compareceu, encaixe e cliente anonimizada ocupam → só 09:00', async () => {
    const x = await comJornadaDaAna(['09:00', '14:00']);
    const [{ id: C }] = (await c.query<{ id: string }>(
      `INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min, ativo) VALUES ($1, 'C', 6000, 60, true) RETURNING id::text AS id`,
      [x.s.salaoId],
    )).rows;
    await c.query('INSERT INTO servico_profissional (salao_id, servico_id, profissional_id) VALUES ($1, $2, $3)', [x.s.salaoId, C, x.ana]);
    const cli = await inserirCliente(c, x.s.salaoId);
    const anon = await inserirCliente(c, x.s.salaoId, true);
    const R = (h1: string, h2: string, extra: object = {}) =>
      inserirReserva(c, { salaoId: x.s.salaoId, profissionalId: x.ana, clienteId: cli, inicio: sp(DIA, h1), fim: sp(DIA, h2), ...extra });
    await R('09:00', '10:00', { status: 'cancelado' });
    await R('10:00', '11:00', { status: 'concluido' });
    await R('11:00', '12:00', { status: 'nao_compareceu' });
    await R('12:00', '13:00', { encaixe: true });
    await R('13:00', '14:00', { clienteId: anon });
    expect(rotulos(await consultar(x, so(x.ana, [C])))).toEqual(['09:00']);
  });

  it('serviço desativado depois de reservado continua ocupando o profissional (RN-7)', async () => {
    const x = await comJornadaDaAna(['09:00', '10:00']);
    const cli = await inserirCliente(c, x.s.salaoId);
    await inserirReserva(c, { salaoId: x.s.salaoId, profissionalId: x.ana, clienteId: cli, inicio: sp(DIA, '09:00'), fim: sp(DIA, '09:30') });
    await c.query('UPDATE servico SET ativo = false WHERE id = $1', [x.B]);
    expect(rotulos(await consultar(x, so(x.ana, [x.A])))).toEqual(['09:30']);
  });

  it('CA-19: troca de fuso reinterpreta a jornada e mantém o UTC do bloqueio', async () => {
    const x = await criarCenario(c);
    await inserirJornada(c, x.s.salaoId, x.ana, TODOS_OS_DIAS, ['09:00', '12:00']);
    await inserirBloqueio(c, x.s.salaoId, x.ana, new Date('2026-12-01T12:00:00Z'), new Date('2026-12-01T13:00:00Z'));
    const antes = await consultar(x, so(x.ana, [x.A]));
    expect(rotulos(antes)[0]).toBe('10:00'); // 09:00–10:00 SP está bloqueado
    await definirRegras(c, x.s.salaoId, { fuso: MANAUS });
    const depois = await consultar(x, so(x.ana, [x.A]));
    if (depois.resultado !== 'ok') throw new Error();
    expect(depois.fuso).toBe(MANAUS);
    const primeiro = depois.servicos[0].profissionais[0].dias[0].horarios[0];
    expect(primeiro.inicio.toISOString()).toBe('2026-12-01T13:00:00.000Z');
    expect(primeiro.local.minutosDoDia).toBe(540);
  });

  it('CA-22: elegível sem jornada no dia aparece com lista vazia', async () => {
    const x = await criarCenario(c);
    await inserirJornada(c, x.s.salaoId, x.bia, [3], ['09:00', '10:00']); // só quarta
    const r = await consultar(x);
    if (r.resultado !== 'ok') throw new Error();
    expect(r.servicos[0].profissionais.map((p) => p.nome)).toEqual(['Ana', 'Bia']);
    expect(rotulos(r, 0)).toEqual([]);
    expect(rotulos(r, 1)).toEqual([]);
    const quarta = await consultar(x, { de: DIA_SEGUINTE, ate: DIA_SEGUINTE });
    expect(rotulos(quarta, 1)).toEqual(['09:00', '09:15', '09:30']);
  });
});

describe('janela e entradas inválidas (CA-21)', () => {
  it('datas no passado e depois de hoje + janela → listas vazias, sem erro; o limite tem horários', async () => {
    const x = await comJornadaDaAna(['09:00', '12:00']);
    const r = await consultar(x, {
      ...so(x.ana, [x.A]),
      de: { ano: 2026, mes: 11, dia: 19 },
      ate: { ano: 2026, mes: 11, dia: 20 },
    });
    expect(rotulos(r, 0, 0)).toEqual([]);
    const limite = await consultar(x, { ...so(x.ana, [x.A]), de: { ano: 2027, mes: 1, dia: 19 }, ate: { ano: 2027, mes: 1, dia: 20 } });
    if (limite.resultado !== 'ok') throw new Error();
    expect(rotulos(limite, 0, 0).length).toBeGreaterThan(0);
    expect(rotulos(limite, 0, 1)).toEqual([]);
    expect(limite.servicos[0].profissionais[0].dias.map((d) => d.data)).toEqual([
      { ano: 2027, mes: 1, dia: 19 },
      { ano: 2027, mes: 1, dia: 20 },
    ]);
  });

  it('período inteiro fora da janela → ok com dias vazios', async () => {
    const x = await comJornadaDaAna(['09:00', '12:00']);
    const r = await consultar(x, { de: { ano: 2030, mes: 1, dia: 1 }, ate: { ano: 2030, mes: 1, dia: 3 } });
    if (r.resultado !== 'ok') throw new Error();
    expect(r.servicos[0].profissionais).toHaveLength(2);
    for (const p of r.servicos[0].profissionais) expect(p.dias.map((d) => d.horarios)).toEqual([[], [], []]);
  });

  it('entradas inválidas e período com mais de janela_dias + 1 datas', async () => {
    const x = await criarCenario(c);
    const d = (mes: number, dia: number, ano = 2026) => ({ ano, mes, dia });
    expect(await consultar(x, { servicoIds: [] })).toEqual({ resultado: 'entrada_invalida', motivo: 'servicos_vazio' });
    expect(await consultar(x, { servicoIds: [x.A, x.A] })).toEqual({ resultado: 'entrada_invalida', motivo: 'servicos_repetidos' });
    expect(await consultar(x, { servicoIds: Array.from({ length: 11 }, (_, i) => `s${i}`) })).toEqual({ resultado: 'entrada_invalida', motivo: 'servicos_demais' });
    expect(await consultar(x, { de: d(2, 31), ate: d(3, 1) })).toEqual({ resultado: 'entrada_invalida', motivo: 'data_invalida' });
    expect(await consultar(x, { de: d(12, 2), ate: d(12, 1) })).toEqual({ resultado: 'entrada_invalida', motivo: 'periodo_invertido' });
    expect(await consultar(x, { de: d(12, 1), ate: d(1, 31, 2027) })).toEqual({ resultado: 'entrada_invalida', motivo: 'periodo_longo' });
    expect(await consultar(x, { escolhidos: [{ servicoId: x.B, profissionalId: x.ana, inicio: sp(DIA, '09:00') }] })).toEqual({ resultado: 'entrada_invalida', motivo: 'escolhidos_invalidos' });
    expect(await consultar(x, { calcular: [x.B] })).toEqual({ resultado: 'entrada_invalida', motivo: 'calculo_invalido' });
    expect(await consultar(x, { servicoIds: [x.A, x.B], profissionalPorServico: { [x.A]: x.ana } })).toEqual({ resultado: 'entrada_invalida', motivo: 'calculo_invalido' });
    // 61 datas (janela_dias + 1) é o máximo aceito.
    expect((await consultar(x, { de: d(12, 1), ate: d(1, 30, 2027) })).resultado).toBe('ok');
  });

  it('serviço malformado, inexistente ou inativo → servico_indisponivel', async () => {
    const x = await criarCenario(c);
    expect(await consultar(x, { servicoIds: ['lixo'] })).toEqual({ resultado: 'servico_indisponivel' });
    expect(await consultar(x, { servicoIds: [UUID_INEXISTENTE] })).toEqual({ resultado: 'servico_indisponivel' });
    expect(await consultar(x, { servicoIds: [x.s.servicos.inativoId] })).toEqual({ resultado: 'servico_indisponivel' });
  });

  it('agora inválido → RangeError', async () => {
    const x = await criarCenario(c);
    await expect(consultar(x, { agora: new Date(NaN) })).rejects.toBeInstanceOf(RangeError);
  });
});

describe('horário de funcionamento (CA-29, CA-31, CA-32, CA-38, CA-39, RN-24)', () => {
  it('CA-29: dia fechado → lista vazia com a Ana no resultado; dia aberto adjacente tem horários', async () => {
    const x = await comJornadaDaAna(['09:00', '12:00']);
    await definirFuncionamento(c, x.s.salaoId, { 3: [['09:00', '12:00']] });
    const r = await consultar(x, { ...so(x.ana, [x.A]), de: DIA, ate: DIA_SEGUINTE });
    if (r.resultado !== 'ok') throw new Error();
    expect(profissionaisDe(r, x.A)).toEqual([x.ana]);
    expect(rotulos(r, 0, 0)).toEqual([]);
    expect(rotulos(r, 0, 1)).toEqual(faixa('09:00', '11:30'));
  });

  it('CA-31: não informado, com ou sem linhas residuais, não limita e dá o mesmo resultado', async () => {
    const x = await comJornadaDaAna(['09:00', '12:00']);
    const base = await consultar(x, so(x.ana, [x.A]));
    await definirFuncionamento(c, x.s.salaoId, { 2: [['10:00', '11:00']] });
    expect(rotulos(await consultar(x, so(x.ana, [x.A])))).toEqual(['10:00', '10:15', '10:30']);
    await marcarFuncionamentoNaoInformado(c, x.s.salaoId); // linhas residuais
    expect(await consultar(x, so(x.ana, [x.A]))).toEqual(base);
    expect(rotulos(base)).toEqual(faixa('09:00', '11:30'));
  });

  it('CA-32: informado com os sete dias fechados → nenhum horário para ninguém', async () => {
    const x = await criarCenario(c);
    await inserirJornada(c, x.s.salaoId, x.ana, TODOS_OS_DIAS, ['00:00', '24:00']);
    await inserirJornada(c, x.s.salaoId, x.bia, TODOS_OS_DIAS, ['09:00', '12:00']);
    await definirFuncionamento(c, x.s.salaoId, {});
    const r = await consultar(x, { de: DIA, ate: { ano: 2026, mes: 12, dia: 5 } });
    if (r.resultado !== 'ok') throw new Error();
    expect(r.servicos[0].profissionais).toHaveLength(2);
    for (const p of r.servicos[0].profissionais) for (const d of p.dias) expect(d.horarios).toEqual([]);
  });

  it('CA-30/33: interseção com a pausa do funcionamento e da jornada (B, 45 min)', async () => {
    const x = await comJornadaDaAna(['09:00', '12:00'], ['13:00', '18:00']);
    await definirFuncionamento(c, x.s.salaoId, { 2: [['08:00', '18:00']] });
    const r = await consultar(x, so(x.ana, [x.B]));
    expect(rotulos(r)).not.toContain('11:30');
    expect(rotulos(r)).toContain('13:00');
    expect(rotulos(r)).toContain('11:15');
  });

  it('CA-38: encaixe fora do funcionamento não afeta, mas o ocupado_ate (com intervalo) invade a janela', async () => {
    const x = await comJornadaDaAna(['07:00', '12:00']);
    await definirFuncionamento(c, x.s.salaoId, { 2: [['09:00', '18:00']] });
    await definirRegras(c, x.s.salaoId, { intervalo_min: 15 });
    const cli = await inserirCliente(c, x.s.salaoId);
    await inserirReserva(c, { salaoId: x.s.salaoId, profissionalId: x.ana, clienteId: cli, inicio: sp(DIA, '07:00'), fim: sp(DIA, '08:00'), encaixe: true });
    expect(rotulos(await consultar(x, so(x.ana, [x.A])))[0]).toBe('09:00');
    await inserirReserva(c, { salaoId: x.s.salaoId, profissionalId: x.ana, clienteId: cli, inicio: sp(DIA, '08:30'), fim: sp(DIA, '09:00'), ocupadoAte: sp(DIA, '09:15'), encaixe: true });
    expect(rotulos(await consultar(x, so(x.ana, [x.A])))[0]).toBe('09:15');
  });

  it('CA-39: troca de fuso mantém os minutos de parede do funcionamento e da jornada', async () => {
    const x = await comJornadaDaAna(['09:00', '12:00']);
    await definirFuncionamento(c, x.s.salaoId, { 2: [['09:00', '12:00']] });
    expect(rotulos(await consultar(x, so(x.ana, [x.A])))[0]).toBe('09:00');
    await definirRegras(c, x.s.salaoId, { fuso: MANAUS });
    const r = await consultar(x, so(x.ana, [x.A]));
    if (r.resultado !== 'ok') throw new Error();
    expect(r.servicos[0].profissionais[0].dias[0].horarios[0].inicio.toISOString()).toBe('2026-12-01T13:00:00.000Z');
    expect(rotulos(r)[0]).toBe('09:00');
  });

  it('RN-24: sem cache; alternar o estado entre duas consultas muda o resultado', async () => {
    const x = await comJornadaDaAna(['09:00', '12:00']);
    const consulta = () => consultar(x, so(x.ana, [x.A]));
    expect(rotulos(await consulta())).toHaveLength(11);
    await definirFuncionamento(c, x.s.salaoId, {});
    expect(rotulos(await consulta())).toEqual([]);
    await definirFuncionamento(c, x.s.salaoId, { 2: [['09:00', '10:00']] });
    expect(rotulos(await consulta())).toEqual(['09:00', '09:15', '09:30']);
    await marcarFuncionamentoNaoInformado(c, x.s.salaoId);
    expect(rotulos(await consulta())).toHaveLength(11);
  });
});

describe('contextos', () => {
  it('o PublicoContext e o TenantContext do gestor dão o mesmo resultado', async () => {
    const { ctxDoGestor } = await import('./apoio');
    const x = await comJornadaDaAna(['09:00', '12:00']);
    const entrada = { servicoIds: [x.A], de: DIA, ate: DIA, agora: AGORA };
    expect(await consultarDisponibilidadePorServico(ctxDoGestor(x.s), entrada)).toEqual(await consultarDisponibilidadePorServico(ctxPublico(x.s), entrada));
  });
});
