import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultarDisponibilidadePorServico, horarioOferecido } from '@/server/disponibilidade/servico';
import type { EntradaDisponibilidadePorServico } from '@/server/disponibilidade/tipos';

import { conectar } from '../../support/sql';

import {
  AGORA, DIA, TODOS_OS_DIAS, criarCenario, ctxPublico, definirRegras, faixa, inserirBloqueio, inserirCliente,
  inserirJornada, inserirProfissional, inserirReserva, inserirReservaComItens, profissionaisDe, rotulosDe, sp, vincular,
} from './apoio';
import type { Cenario } from './apoio';

// D-050 T-3: disponibilidade POR SERVIÇO contra PostgreSQL real. CA-1 (profissionais por serviço, com a
// duração do próprio serviço), CA-2 (sem profissional comum), CA-4 (itens já escolhidos ocupam o mesmo
// profissional com intervalo e a cliente para todos), C3 (`vazioPorConflito`) e a ocupação por ITEM.

let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

const consultar = (x: Cenario, e: Partial<EntradaDisponibilidadePorServico>) =>
  consultarDisponibilidadePorServico(ctxPublico(x.s), { servicoIds: [x.A, x.B], de: DIA, ate: DIA, agora: AGORA, ...e });

async function servico(x: Cenario, nome: string, duracaoMin: number): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min, ativo) VALUES ($1, $2, 7000, $3, true) RETURNING id::text AS id`,
    [x.s.salaoId, nome, duracaoMin],
  );
  return rows[0].id;
}

describe('CA-1 e CA-2: profissionais por serviço, sem exigir profissional comum', () => {
  it('A vinculado a Ana e a uma inativa; B só a Carla: A lista só Ana e B só Carla, cada um com as próprias regras', async () => {
    const x = await criarCenario(c);
    await c.query('DELETE FROM servico_profissional WHERE salao_id = $1 AND profissional_id = ANY($2::uuid[])', [x.s.salaoId, [x.ana, x.bia]]);
    await vincular(c, x.s.salaoId, x.A, x.ana);
    const inativa = await inserirProfissional(c, x.s.salaoId, 'Inês', false);
    await vincular(c, x.s.salaoId, x.A, inativa);
    const carla = await inserirProfissional(c, x.s.salaoId, 'Carla');
    await vincular(c, x.s.salaoId, x.B, carla);
    await inserirJornada(c, x.s.salaoId, x.ana, TODOS_OS_DIAS, ['09:00', '12:00']);
    await inserirJornada(c, x.s.salaoId, inativa, TODOS_OS_DIAS, ['09:00', '12:00']);
    await inserirJornada(c, x.s.salaoId, carla, TODOS_OS_DIAS, ['09:00', '11:00']);
    const cli = await inserirCliente(c, x.s.salaoId);
    await inserirReserva(c, { salaoId: x.s.salaoId, profissionalId: x.ana, clienteId: cli, inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30'), servicoId: x.A });
    await inserirBloqueio(c, x.s.salaoId, carla, sp(DIA, '10:00'), sp(DIA, '10:15'));

    const r = await consultar(x, {});
    // CA-2: nenhum profissional faz A e B, e ambos têm horários.
    expect(profissionaisDe(r, x.A)).toEqual([x.ana]);
    expect(profissionaisDe(r, x.B)).toEqual([carla]);
    // A (30 min) com a Ana: a reserva 10:00–10:30 tira (09:30, 10:30).
    expect(rotulosDe(r, x.A, x.ana)).toEqual(['09:00', '09:15', '09:30', '10:30', '10:45', '11:00', '11:15', '11:30']);
    // B (45 min) com a Carla, jornada até 11:00 e bloqueio 10:00–10:15.
    expect(rotulosDe(r, x.B, carla)).toEqual(['09:00', '09:15', '10:15']);
    if (r.resultado !== 'ok') throw new Error();
    const b = r.servicos[1].profissionais[0].dias[0].horarios[0];
    expect(b.fim.getTime() - b.inicio.getTime()).toBe(45 * 60_000);
  });

  it('um serviço sem profissional elegível não impede o outro', async () => {
    const x = await criarCenario(c);
    await inserirJornada(c, x.s.salaoId, x.bia, TODOS_OS_DIAS, ['09:00', '10:00']);
    const r = await consultar(x, { profissionalPorServico: { [x.A]: x.bia, [x.B]: x.bia } });
    expect(profissionaisDe(r, x.A)).toEqual([x.bia]);
    expect(profissionaisDe(r, x.B)).toEqual([]);
    expect(rotulosDe(r, x.A, x.bia)).toEqual(['09:00', '09:15', '09:30']);
  });
});

describe('CA-4 (RN-8, RN-9, RN-10): itens já escolhidos', () => {
  /** Grade 5, intervalo 10; S60 (60 min) e S40 (40 min) feitos por Ana e Bia, jornada 08–12. */
  async function cenarioCA4() {
    const x = await criarCenario(c);
    await definirRegras(c, x.s.salaoId, { grade_min: 5, intervalo_min: 10 });
    const s60 = await servico(x, 'Sessenta', 60);
    const s40 = await servico(x, 'Quarenta', 40);
    for (const p of [x.ana, x.bia]) {
      for (const s of [s60, s40]) await vincular(c, x.s.salaoId, s, p);
      await inserirJornada(c, x.s.salaoId, p, TODOS_OS_DIAS, ['08:00', '12:00']);
    }
    return { x, s60, s40 };
  }

  it('A com a Ana às 09:00–10:00: em B (40 min), ninguém em (08:20, 10:00); Ana nada em (08:10, 10:10)', async () => {
    const { x, s60, s40 } = await cenarioCA4();
    const r = await consultar(x, {
      servicoIds: [s60, s40],
      calcular: [s40],
      escolhidos: [{ servicoId: s60, profissionalId: x.ana, inicio: sp(DIA, '09:00') }],
    });
    expect(r).toMatchObject({ resultado: 'ok', intervaloMin: 10, servicos: [{ servicoId: s40, vazioPorConflito: false }] });
    expect(rotulosDe(r, s40, x.bia)).toEqual([...faixa('08:00', '08:20', 5), ...faixa('10:00', '11:20', 5)]);
    expect(rotulosDe(r, s40, x.ana)).toEqual([...faixa('08:00', '08:10', 5), ...faixa('10:10', '11:20', 5)]);
  });

  it('o escolhido do PRÓPRIO serviço não desconta nada; o de outro desconta também no cálculo de todos', async () => {
    const { x, s60, s40 } = await cenarioCA4();
    const escolhidos = [
      { servicoId: s60, profissionalId: x.ana, inicio: sp(DIA, '09:00') },
      { servicoId: s40, profissionalId: x.bia, inicio: sp(DIA, '10:00') },
    ];
    const r = await consultar(x, { servicoIds: [s60, s40], escolhidos });
    // S60 (60 min) desconta só o S40 da Bia [10:00, 10:40) (+10 para a Bia).
    expect(rotulosDe(r, s60, x.ana)).toEqual([...faixa('08:00', '09:00', 5), ...faixa('10:40', '11:00', 5)]);
    expect(rotulosDe(r, s60, x.bia)).toEqual([...faixa('08:00', '08:50', 5), ...faixa('10:50', '11:00', 5)]);
    // S40 desconta só o S60 da Ana.
    expect(rotulosDe(r, s40, x.bia)).toEqual([...faixa('08:00', '08:20', 5), ...faixa('10:00', '11:20', 5)]);
    if (r.resultado !== 'ok') throw new Error();
    // Revalidação: cada item escolhido é oferecido ao seu profissional; um início em conflito não é.
    expect(horarioOferecido(r.servicos[0], x.ana, sp(DIA, '09:00'))).toBe(true);
    expect(horarioOferecido(r.servicos[1], x.bia, sp(DIA, '10:00'))).toBe(true);
    expect(horarioOferecido(r.servicos[1], x.bia.toUpperCase(), sp(DIA, '10:00'))).toBe(true);
    expect(horarioOferecido(r.servicos[1], x.bia, sp(DIA, '09:30'))).toBe(false);
    expect(horarioOferecido(r.servicos[1], x.s.profissionalInativoId, sp(DIA, '10:00'))).toBe(false);
  });

  it('revalidação com profissionalPorServico e todos os itens como escolhidos (forma da T-5)', async () => {
    const { x, s60, s40 } = await cenarioCA4();
    const ok = await consultar(x, {
      servicoIds: [s60, s40],
      escolhidos: [
        { servicoId: s60, profissionalId: x.ana, inicio: sp(DIA, '09:00') },
        { servicoId: s40, profissionalId: x.ana, inicio: sp(DIA, '10:10') },
      ],
      profissionalPorServico: { [s60]: x.ana, [s40]: x.ana },
    });
    if (ok.resultado !== 'ok') throw new Error();
    expect(horarioOferecido(ok.servicos[0], x.ana, sp(DIA, '09:00'))).toBe(true);
    expect(horarioOferecido(ok.servicos[1], x.ana, sp(DIA, '10:10'))).toBe(true);
    // 10:05 com a mesma profissional invade o intervalo de 10 min (RN-9).
    const ruim = await consultar(x, {
      servicoIds: [s60, s40],
      escolhidos: [
        { servicoId: s60, profissionalId: x.ana, inicio: sp(DIA, '09:00') },
        { servicoId: s40, profissionalId: x.ana, inicio: sp(DIA, '10:05') },
      ],
      profissionalPorServico: { [s60]: x.ana, [s40]: x.ana },
    });
    if (ruim.resultado !== 'ok') throw new Error();
    expect(horarioOferecido(ruim.servicos[1], x.ana, sp(DIA, '10:05'))).toBe(false);
    expect(horarioOferecido(ruim.servicos[0], x.ana, sp(DIA, '09:00'))).toBe(false);
  });
});

describe('C3: vazioPorConflito', () => {
  it('verdadeiro quando só os escolhidos esvaziam o serviço; falso sem escolhidos ou quando vazio por outro motivo', async () => {
    const x = await criarCenario(c);
    const longo = await servico(x, 'Longo', 180);
    for (const p of [x.ana, x.bia]) {
      await vincular(c, x.s.salaoId, longo, p);
      await inserirJornada(c, x.s.salaoId, p, TODOS_OS_DIAS, ['09:00', '12:00']);
    }
    const escolhidos = [{ servicoId: longo, profissionalId: x.ana, inicio: sp(DIA, '09:00') }];
    const r = await consultar(x, { servicoIds: [x.A, longo], calcular: [x.A], escolhidos });
    expect(r).toMatchObject({ resultado: 'ok', servicos: [{ servicoId: x.A, vazioPorConflito: true }] });
    expect(rotulosDe(r, x.A, x.ana)).toEqual([]);
    expect(rotulosDe(r, x.A, x.bia)).toEqual([]);

    const sem = await consultar(x, { servicoIds: [x.A, longo], calcular: [x.A] });
    expect(sem).toMatchObject({ resultado: 'ok', servicos: [{ vazioPorConflito: false }] });
    expect(rotulosDe(sem, x.A, x.bia)).toEqual(faixa('09:00', '11:30'));

    // Dia sem jornada: vazio, mas não por conflito.
    const dom = { ano: 2026, mes: 12, dia: 6 };
    await c.query('DELETE FROM jornada WHERE salao_id = $1 AND dia_semana = 0', [x.s.salaoId]);
    const domingo = await consultar(x, {
      servicoIds: [x.A, longo],
      calcular: [x.A],
      de: dom,
      ate: dom,
      escolhidos: [{ servicoId: longo, profissionalId: x.ana, inicio: sp(dom, '09:00') }],
    });
    expect(domingo).toMatchObject({ resultado: 'ok', servicos: [{ vazioPorConflito: false }] });
  });

  it('falso quando ainda há algum horário com o desconto', async () => {
    const x = await criarCenario(c);
    await inserirJornada(c, x.s.salaoId, x.ana, TODOS_OS_DIAS, ['09:00', '12:00']);
    const r = await consultar(x, { calcular: [x.A], escolhidos: [{ servicoId: x.B, profissionalId: x.ana, inicio: sp(DIA, '09:00') }] });
    expect(r).toMatchObject({ resultado: 'ok', servicos: [{ vazioPorConflito: false }] });
    expect(rotulosDe(r, x.A, x.ana)).toEqual(faixa('09:45', '11:30'));
  });
});

describe('ocupação por ITEM (RN-7, RN-15)', () => {
  it('cada item de uma reserva com 2 profissionais ocupa só o seu; item cancelado não ocupa', async () => {
    const x = await criarCenario(c);
    for (const p of [x.ana, x.bia]) await inserirJornada(c, x.s.salaoId, p, TODOS_OS_DIAS, ['09:00', '11:00']);
    const cli = await inserirCliente(c, x.s.salaoId);
    await inserirReservaComItens(c, {
      salaoId: x.s.salaoId,
      clienteId: cli,
      itens: [
        { profissionalId: x.ana, inicio: sp(DIA, '09:00'), duracaoMin: 30, servicoId: x.A },
        { profissionalId: x.bia, inicio: sp(DIA, '10:00'), duracaoMin: 45, servicoId: x.B, status: 'cancelado' },
      ],
    });
    const cli2 = await inserirCliente(c, x.s.salaoId);
    await inserirReservaComItens(c, {
      salaoId: x.s.salaoId,
      clienteId: cli2,
      itens: [{ profissionalId: x.bia, inicio: sp(DIA, '09:30'), duracaoMin: 30, servicoId: x.A, status: 'concluido' }],
    });
    const r = await consultar(x, { servicoIds: [x.A] });
    expect(rotulosDe(r, x.A, x.ana)).toEqual(['09:30', '09:45', '10:00', '10:15', '10:30']);
    expect(rotulosDe(r, x.A, x.bia)).toEqual(['09:00', '10:00', '10:15', '10:30']);
  });
});
