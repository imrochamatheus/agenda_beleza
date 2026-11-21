import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultarDisponibilidade, listarProfissionaisElegiveis } from '@/server/disponibilidade/servico';
import type { EntradaDisponibilidade } from '@/server/disponibilidade/tipos';
import { criarRepos } from '@/server/repos';

import { conectar } from '../../support/sql';

import {
  AGORA, TODOS_OS_DIAS, criarCenario, criarClienteComLog, ctxPublico, definirFuncionamento, inserirCliente,
  inserirJornada, inserirProfissional, inserirReserva, rotulos, sp, vincular, DIA,
} from './apoio';
import type { Cenario } from './apoio';

// D-018 T-4 (CA-26, CA-41, CA-21): o número de instruções SQL por chamada é constante (6),
// independente de datas e profissionais e de o salão ter funcionamento informado, e as entradas
// inválidas não tocam a tabela de reservas. Instrumento: evento `query` do Prisma (A-6).

let c: pg.Client;
let semFunc: Cenario;
let comFunc: Cenario;

const D = (ano: number, mes: number, dia: number) => ({ ano, mes, dia });
// 61 datas, todas dentro da janela (agora = 20/11/2026; janela 60 dias).
const DE = D(2026, 11, 20);
const ATE = D(2027, 1, 19);

async function salaoCom10(comFuncionamento: boolean): Promise<Cenario> {
  const x = await criarCenario(c);
  const ids = [x.ana, x.bia];
  for (let k = 3; k <= 10; k++) {
    const id = await inserirProfissional(c, x.s.salaoId, `Prof ${k}`);
    await vincular(c, x.s.salaoId, x.A, id);
    ids.push(id);
  }
  for (const id of ids) await inserirJornada(c, x.s.salaoId, id, TODOS_OS_DIAS, ['09:00', '12:00'], ['13:00', '18:00']);
  const cli = await inserirCliente(c, x.s.salaoId);
  await inserirReserva(c, { salaoId: x.s.salaoId, profissionalId: x.ana, clienteId: cli, inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') });
  if (comFuncionamento) await definirFuncionamento(c, x.s.salaoId, Object.fromEntries(TODOS_OS_DIAS.map((d) => [d, [['09:00', '12:00'], ['13:00', '17:00']]])));
  return x;
}

beforeAll(async () => {
  c = await conectar();
  semFunc = await salaoCom10(false);
  comFunc = await salaoCom10(true);
});
afterAll(async () => {
  await c.end();
});

const ehControle = (q: string) => /^\s*(BEGIN|COMMIT|ROLLBACK|SET |DEALLOCATE)/i.test(q);

async function contar(
  x: Cenario,
  entrada: Partial<EntradaDisponibilidade>,
): Promise<{ consultas: string[]; resultado: Awaited<ReturnType<typeof consultarDisponibilidade>> }> {
  const log = criarClienteComLog();
  try {
    const resultado = await consultarDisponibilidade(
      ctxPublico(x.s),
      { servicoIds: [x.A], de: DE, ate: DE, agora: AGORA, ...entrada },
      criarRepos(log.cliente).disponibilidade,
    );
    return { consultas: log.consultas.filter((q) => !ehControle(q)), resultado };
  } finally {
    await log.encerrar();
  }
}

describe('CA-26/CA-41: número constante de instruções SQL (6)', () => {
  for (const [nome, qual] of [['sem funcionamento', () => semFunc], ['com funcionamento', () => comFunc]] as const) {
    it(`${nome}: 1 profissional × 1 data e 10 profissionais × 61 datas emitem 6 instruções cada`, async () => {
      const x = qual();
      const pequena = await contar(x, { profissionalId: x.ana });
      const grande = await contar(x, { de: DE, ate: ATE });
      expect(pequena.consultas).toHaveLength(6);
      expect(grande.consultas).toHaveLength(6);
      expect(pequena.consultas.length).toBe(grande.consultas.length);
      if (grande.resultado.resultado !== 'ok' || pequena.resultado.resultado !== 'ok') throw new Error();
      expect(grande.resultado.profissionais).toHaveLength(10);
      expect(grande.resultado.profissionais[0].dias).toHaveLength(61);
      expect(pequena.resultado.profissionais).toHaveLength(1);
    }, 60_000);
  }

  it('o funcionamento é lido na instrução das regras: nenhuma instrução toca salao_funcionamento fora dela', async () => {
    const { consultas } = await contar(comFunc, { de: DE, ate: ATE });
    const com = consultas.filter((q) => q.includes('salao_funcionamento'));
    expect(com).toHaveLength(1);
    expect(com[0]).toMatch(/FROM "?salao"? s/i);
    expect(consultas.filter((q) => /FROM reserva/i.test(q))).toHaveLength(1);
  });

  it('o funcionamento informado produz horários diferentes do salão sem ele (o instrumento mede o caso real)', async () => {
    const a = await contar(semFunc, { profissionalId: semFunc.ana, de: DIA, ate: DIA });
    const b = await contar(comFunc, { profissionalId: comFunc.ana, de: DIA, ate: DIA });
    expect(rotulos(a.resultado)).toContain('17:00');
    expect(rotulos(b.resultado)).not.toContain('17:00');
  });
});

describe('curtos-circuitos (A-4, CA-21): nunca consultam reserva', () => {
  const tocaReserva = (qs: string[]) => qs.some((q) => /\breserva\b/i.test(q));

  it('entrada inválida: nenhuma instrução', async () => {
    for (const parcial of [
      { servicoIds: [] },
      { servicoIds: [semFunc.A, semFunc.A] },
      { servicoIds: Array.from({ length: 11 }, (_, i) => `s${i}`) },
      { de: D(2026, 2, 31), ate: D(2026, 3, 1) },
      { de: D(2026, 12, 2), ate: D(2026, 12, 1) },
    ]) {
      const { consultas } = await contar(semFunc, parcial);
      expect(consultas).toHaveLength(0);
    }
  });

  it('período longo: só as regras (1 instrução)', async () => {
    const { consultas, resultado } = await contar(semFunc, { de: DE, ate: D(2027, 1, 20) });
    expect(resultado).toEqual({ resultado: 'entrada_invalida', motivo: 'periodo_longo' });
    expect(consultas).toHaveLength(1);
  });

  it('serviço indisponível: 2 instruções, sem reserva', async () => {
    const { consultas, resultado } = await contar(semFunc, { servicoIds: [semFunc.s.servicos.inativoId] });
    expect(resultado).toEqual({ resultado: 'servico_indisponivel' });
    expect(consultas).toHaveLength(2);
    expect(tocaReserva(consultas)).toBe(false);
  });

  it('nenhum elegível (Bia não faz B): 3 instruções, sem reserva', async () => {
    const { consultas, resultado } = await contar(semFunc, { servicoIds: [semFunc.A, semFunc.B], profissionalId: semFunc.bia });
    expect(resultado).toMatchObject({ resultado: 'ok', profissionais: [] });
    expect(consultas).toHaveLength(3);
    expect(tocaReserva(consultas)).toBe(false);
  });

  it('período inteiro fora da janela: 3 instruções, sem reserva', async () => {
    const { consultas, resultado } = await contar(semFunc, { de: D(2030, 1, 1), ate: D(2030, 1, 5) });
    expect(resultado).toMatchObject({ resultado: 'ok' });
    expect(consultas).toHaveLength(3);
    expect(tocaReserva(consultas)).toBe(false);
  });

  it('listarProfissionaisElegiveis: 2 instruções', async () => {
    const log = criarClienteComLog();
    try {
      const r = await listarProfissionaisElegiveis(ctxPublico(semFunc.s), [semFunc.A], criarRepos(log.cliente).disponibilidade);
      expect(r).toMatchObject({ resultado: 'ok' });
      expect(log.consultas.filter((q) => !ehControle(q))).toHaveLength(2);
    } finally {
      await log.encerrar();
    }
  });
});
