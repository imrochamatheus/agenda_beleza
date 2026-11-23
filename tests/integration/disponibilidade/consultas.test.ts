import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultarDisponibilidadePorServico } from '@/server/disponibilidade/servico';
import type { EntradaDisponibilidadePorServico } from '@/server/disponibilidade/tipos';
import { criarRepos } from '@/server/repos';
import { NaoEncontrado } from '@/server/tenant/erros';

import { conectar } from '../../support/sql';

import {
  AGORA, DIA, TODOS_OS_DIAS, criarCenario, criarClienteComLog, ctxPublico, definirFuncionamento, inserirCliente,
  inserirJornada, inserirProfissional, inserirReserva, rotulos, sp, vincular,
} from './apoio';
import type { Cenario } from './apoio';

// D-050 CA-3 (herda D-018 CA-26/CA-41): o número de instruções SQL por chamada de
// `consultarDisponibilidadePorServico` é constante (6) com 1, 3 e 10 serviços, 1 e 8 profissionais e 1 e
// 14 datas, com ou sem funcionamento informado, com ou sem itens escolhidos, `calcular` e restrição por
// profissional; o vazio por conflito (C3) não emite instrução a mais; as entradas inválidas não tocam
// `reserva_item`. Instrumento: evento `query` do Prisma.

let c: pg.Client;

type Grande = Cenario & { servicos: string[]; profissionais: string[] };
const salas = new Map<string, Grande>();
let base: Cenario;

const D = (ano: number, mes: number, dia: number) => ({ ano, mes, dia });
const DIA_14 = D(2026, 12, 14);

/** Salão com 10 serviços (A, B + 8) e `n` profissionais vinculados a TODOS, jornada 09–12/13–18. */
async function salaoGrande(n: number, comFuncionamento: boolean): Promise<Grande> {
  const x = await criarCenario(c);
  const servicos = [x.A, x.B];
  for (let k = 3; k <= 10; k++) {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min, ativo) VALUES ($1, $2, 4000, 30, true) RETURNING id::text AS id`,
      [x.s.salaoId, `Serviço ${k}`],
    );
    servicos.push(rows[0].id);
  }
  const profissionais = [x.ana];
  if (n > 1) profissionais.push(x.bia);
  for (let k = 3; k <= n; k++) profissionais.push(await inserirProfissional(c, x.s.salaoId, `Prof ${k}`));
  if (n === 1) await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [x.bia]);
  for (const p of profissionais) {
    for (const s of servicos) await vincular(c, x.s.salaoId, s, p);
    await inserirJornada(c, x.s.salaoId, p, TODOS_OS_DIAS, ['09:00', '12:00'], ['13:00', '18:00']);
  }
  const cli = await inserirCliente(c, x.s.salaoId);
  await inserirReserva(c, { salaoId: x.s.salaoId, profissionalId: x.ana, clienteId: cli, inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30'), servicoId: x.A });
  if (comFuncionamento) {
    await definirFuncionamento(c, x.s.salaoId, Object.fromEntries(TODOS_OS_DIAS.map((d) => [d, [['09:00', '12:00'], ['13:00', '17:00']]])));
  }
  return { ...x, servicos, profissionais };
}

beforeAll(async () => {
  c = await conectar();
  for (const n of [1, 8]) {
    for (const f of [false, true]) salas.set(`${n}:${f}`, await salaoGrande(n, f));
  }
  base = await criarCenario(c);
}, 120_000);
afterAll(async () => {
  await c.end();
});

const ehControle = (q: string) => /^\s*(BEGIN|COMMIT|ROLLBACK|SET |DEALLOCATE)/i.test(q);

async function contar(
  x: Cenario,
  entrada: Partial<EntradaDisponibilidadePorServico>,
): Promise<{ consultas: string[]; resultado: Awaited<ReturnType<typeof consultarDisponibilidadePorServico>> }> {
  const log = criarClienteComLog();
  try {
    const resultado = await consultarDisponibilidadePorServico(
      ctxPublico(x.s),
      { servicoIds: [x.A], de: DIA, ate: DIA, agora: AGORA, ...entrada },
      criarRepos(log.cliente).disponibilidade,
    );
    return { consultas: log.consultas.filter((q) => !ehControle(q)), resultado };
  } finally {
    await log.encerrar();
  }
}

describe('CA-3: número constante de instruções SQL (6)', () => {
  const cenarios: [number, number, number, boolean][] = [];
  for (const nServ of [1, 3, 10]) for (const nProf of [1, 8]) for (const nDatas of [1, 14]) for (const f of [false, true]) cenarios.push([nServ, nProf, nDatas, f]);

  it.each(cenarios)('%i serviço(s) × %i profissional(is) × %i data(s), funcionamento informado: %s → 6 instruções', async (nServ, nProf, nDatas, f) => {
    const x = salas.get(`${nProf}:${f}`)!;
    const { consultas, resultado } = await contar(x, { servicoIds: x.servicos.slice(0, nServ), ate: nDatas === 1 ? DIA : DIA_14 });
    expect(consultas).toHaveLength(6);
    if (resultado.resultado !== 'ok') throw new Error(resultado.resultado);
    expect(resultado.servicos).toHaveLength(nServ);
    for (const s of resultado.servicos) {
      expect(s.profissionais).toHaveLength(nProf);
      for (const p of s.profissionais) expect(p.dias).toHaveLength(nDatas);
    }
  }, 60_000);

  it('escolhidos, `calcular` e restrição por profissional não mudam a contagem', async () => {
    const x = salas.get('8:true')!;
    const servicoIds = x.servicos;
    const escolhidos = servicoIds.slice(1).map((s, i) => ({ servicoId: s, profissionalId: x.profissionais[i % 8], inicio: sp(DIA, '13:00') }));
    const a = await contar(x, { servicoIds, escolhidos, calcular: [x.A], ate: DIA_14 });
    const b = await contar(x, {
      servicoIds,
      escolhidos,
      profissionalPorServico: Object.fromEntries(servicoIds.map((s, i) => [s, x.profissionais[i % 8]])),
    });
    expect(a.consultas).toHaveLength(6);
    expect(b.consultas).toHaveLength(6);
    if (a.resultado.resultado !== 'ok' || b.resultado.resultado !== 'ok') throw new Error();
    expect(a.resultado.servicos.map((s) => s.servicoId)).toEqual([x.A]);
    expect(b.resultado.servicos.map((s) => s.profissionais.length)).toEqual(servicoIds.map(() => 1));
  }, 60_000);

  it('C3: o vazio por conflito reexecuta o domínio sem instrução a mais', async () => {
    const x = salas.get('1:false')!;
    // Um serviço de 540 min escolhido com a Ana às 09:00 ocupa a cliente (e a Ana) de 09:00 a 18:00: A fica
    // sem horário no dia, mas teria horários sem o escolhido.
    await c.query('UPDATE servico SET duracao_min = 540 WHERE id = $1', [x.servicos[9]]);
    try {
      const { consultas, resultado } = await contar(x, {
        servicoIds: [x.A, x.servicos[9]],
        calcular: [x.A],
        escolhidos: [{ servicoId: x.servicos[9], profissionalId: x.ana, inicio: sp(DIA, '09:00') }],
      });
      expect(consultas).toHaveLength(6);
      expect(resultado).toMatchObject({ resultado: 'ok', servicos: [{ servicoId: x.A, vazioPorConflito: true }] });
      expect(rotulos(resultado)).toEqual([]);
    } finally {
      await c.query('UPDATE servico SET duracao_min = 30 WHERE id = $1', [x.servicos[9]]);
    }
  });

  it('o funcionamento é lido na instrução das regras; só uma instrução lê reserva_item e nenhuma lê reserva', async () => {
    const x = salas.get('8:true')!;
    const { consultas } = await contar(x, { servicoIds: x.servicos, ate: DIA_14 });
    const com = consultas.filter((q) => q.includes('salao_funcionamento'));
    expect(com).toHaveLength(1);
    expect(com[0]).toMatch(/FROM "?salao"? s/i);
    expect(consultas.filter((q) => /FROM reserva_item/i.test(q))).toHaveLength(1);
    expect(consultas.filter((q) => /\breserva\b(?!_)/i.test(q))).toHaveLength(0);
  });

  it('o funcionamento informado produz horários diferentes do salão sem ele (o instrumento mede o caso real)', async () => {
    const a = await contar(salas.get('8:false')!, {});
    const b = await contar(salas.get('8:true')!, {});
    expect(rotulos(a.resultado)).toContain('17:00');
    expect(rotulos(b.resultado)).not.toContain('17:00');
  });
});

describe('curtos-circuitos: nunca consultam reserva_item', () => {
  const tocaItens = (qs: string[]) => qs.some((q) => /\breserva(_item)?\b/i.test(q));

  it('entrada inválida e restrição malformada: nenhuma instrução', async () => {
    for (const parcial of [
      { servicoIds: [] },
      { servicoIds: [base.A, base.A] },
      { servicoIds: Array.from({ length: 11 }, (_, i) => `s${i}`) },
      { de: D(2026, 2, 31), ate: D(2026, 3, 1) },
      { de: D(2026, 12, 2), ate: D(2026, 12, 1) },
      { escolhidos: [{ servicoId: base.B, profissionalId: base.ana, inicio: sp(DIA, '09:00') }] },
      { calcular: [] },
    ]) {
      const { consultas, resultado } = await contar(base, parcial);
      expect(resultado.resultado).toBe('entrada_invalida');
      expect(consultas).toHaveLength(0);
    }
    const log = criarClienteComLog();
    try {
      await expect(
        consultarDisponibilidadePorServico(
          ctxPublico(base.s),
          { servicoIds: [base.A], de: DIA, ate: DIA, agora: AGORA, profissionalPorServico: { [base.A]: 'x' } },
          criarRepos(log.cliente).disponibilidade,
        ),
      ).rejects.toBeInstanceOf(NaoEncontrado);
      expect(log.consultas.filter((q) => !ehControle(q))).toHaveLength(0);
    } finally {
      await log.encerrar();
    }
  });

  it('período longo: só as regras (1 instrução)', async () => {
    const { consultas, resultado } = await contar(base, { de: D(2026, 11, 20), ate: D(2027, 1, 20) });
    expect(resultado).toEqual({ resultado: 'entrada_invalida', motivo: 'periodo_longo' });
    expect(consultas).toHaveLength(1);
  });

  it('serviço indisponível: 2 instruções, sem itens', async () => {
    const { consultas, resultado } = await contar(base, { servicoIds: [base.A, base.s.servicos.inativoId] });
    expect(resultado).toEqual({ resultado: 'servico_indisponivel' });
    expect(consultas).toHaveLength(2);
    expect(tocaItens(consultas)).toBe(false);
  });

  it('nenhum elegível (Bia não faz B): 3 instruções, sem itens', async () => {
    const { consultas, resultado } = await contar(base, { servicoIds: [base.B], profissionalPorServico: { [base.B]: base.bia } });
    expect(resultado).toMatchObject({ resultado: 'ok', servicos: [{ profissionais: [], vazioPorConflito: false }] });
    expect(consultas).toHaveLength(3);
    expect(tocaItens(consultas)).toBe(false);
  });

  it('restrição a profissional de outro salão: NaoEncontrado depois de 3 instruções, sem itens', async () => {
    const outro = salas.get('1:false')!;
    const log = criarClienteComLog();
    try {
      await expect(
        consultarDisponibilidadePorServico(
          ctxPublico(base.s),
          { servicoIds: [base.A], de: DIA, ate: DIA, agora: AGORA, profissionalPorServico: { [base.A]: outro.ana } },
          criarRepos(log.cliente).disponibilidade,
        ),
      ).rejects.toBeInstanceOf(NaoEncontrado);
      const qs = log.consultas.filter((q) => !ehControle(q));
      expect(qs).toHaveLength(3);
      expect(tocaItens(qs)).toBe(false);
    } finally {
      await log.encerrar();
    }
  });

  it('período inteiro fora da janela: 3 instruções, sem itens', async () => {
    const { consultas, resultado } = await contar(base, { de: D(2030, 1, 1), ate: D(2030, 1, 5) });
    expect(resultado).toMatchObject({ resultado: 'ok' });
    expect(consultas).toHaveLength(3);
    expect(tocaItens(consultas)).toBe(false);
  });
});
