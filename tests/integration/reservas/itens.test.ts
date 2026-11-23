import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReserva } from '@/server/reservas/criar-reserva';
import { MENSAGENS_RESERVA } from '@/server/reservas/tipos';
import { obterPrisma } from '@/server/repos/db';

import { DIA, DIA_SEGUINTE, conferirDerivados, contarLinhas, criarCenarioReserva, entradaReserva, sp } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';

import { item, jornadaDaBia, revalidacao } from './apoio-itens';

// D-050 T-5: CA-5 (RN-8), CA-7 (RN-3), CA-20 (RN-9), M-6 (conferirItens antes de qualquer INSERT, nunca
// 23P01 entre itens da mesma reserva), revalidação e indisponibilidade POR ITEM (índices), CA-6 (3 itens).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();
const enfileirar = async () => ({ criado: true as const, id: 'job' });

async function semEfeito(c: CenarioReserva, fn: () => Promise<unknown>): Promise<void> {
  const antes = await contarLinhas(c.s.salaoId);
  await fn();
  expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
}

describe('CA-5 (RN-8): itens da mesma reserva não se sobrepõem', () => {
  it('envio forjado com A 09:00–10:00 (Bia) e B às 09:30 (Ana): entre_itens no item B, nada gravado', async () => {
    const c = await criarCenarioReserva({ servicoA: { precoCentavos: 5000, duracaoMin: 60 } });
    await jornadaDaBia(c);
    await semEfeito(c, async () => {
      const r = await criarReserva(
        c.ctxSistema,
        entradaReserva(c, { itens: [item(c, sp(DIA, '09:00'), { profissionalId: c.bia }), item(c, sp(DIA, '09:30'), { servicoId: c.B })] }),
        { enfileirar },
      );
      expect(r).toEqual({ resultado: 'horario_indisponivel', causa: 'entre_itens', itens: [1], conflitos: { 1: 0 } });
    });
  });

  it('adjacentes (A.fim = B.inicio) com profissionais diferentes: aceito', async () => {
    const c = await criarCenarioReserva({ servicoA: { precoCentavos: 5000, duracaoMin: 60 } });
    await jornadaDaBia(c);
    const r = await criarReserva(
      c.ctxSistema,
      entradaReserva(c, { itens: [item(c, sp(DIA, '09:00'), { profissionalId: c.bia }), item(c, sp(DIA, '10:00'), { servicoId: c.B })] }),
      { enfileirar },
    );
    expect(r.resultado).toBe('criada');
  });

  it('M-6: dois itens CRUZADOS do MESMO profissional → entre_itens (nunca 23P01), também na equipe em modo encaixe', async () => {
    const c = await criarCenarioReserva();
    const cruzados = [item(c, sp(DIA, '10:00')), item(c, sp(DIA, '10:15'), { servicoId: c.B })];
    const esperado = { resultado: 'horario_indisponivel', causa: 'entre_itens', itens: [1], conflitos: { 1: 0 } };
    await semEfeito(c, async () => {
      expect(await criarReserva(c.ctxSistema, entradaReserva(c, { itens: cruzados }), { enfileirar })).toEqual(esperado);
      // Modo encaixe não revalida: sem conferirItens, o INSERT dos itens bateria na exclusion por profissional.
      expect(await criarReserva(c.ctxEquipe, entradaReserva(c, { itens: cruzados, modo: 'encaixe' }), { enfileirar })).toEqual(esperado);
    });
  });

  it('três itens: cada conflito aponta o item anterior com que cruza (o de maior índice falha)', async () => {
    const c = await criarCenarioReserva({ jornada: [['00:00', '24:00']] });
    const C = (await db().servico.create({ data: { salaoId: c.s.salaoId, nome: 'C', precoCentavos: 3000, duracaoMin: 30 }, select: { id: true } })).id;
    await db().servicoProfissional.create({ data: { salaoId: c.s.salaoId, servicoId: C, profissionalId: c.ana } });
    const r = await criarReserva(
      c.ctxEquipe,
      entradaReserva(c, {
        modo: 'encaixe',
        itens: [item(c, sp(DIA, '10:00')), item(c, sp(DIA, '12:00'), { servicoId: c.B }), item(c, sp(DIA, '12:30'), { servicoId: C })],
      }),
      { enfileirar },
    );
    expect(r).toEqual({ resultado: 'horario_indisponivel', causa: 'entre_itens', itens: [2], conflitos: { 2: 1 } });
  });
});

describe('CA-20 (RN-9): mesmo profissional respeita o intervalo entre itens', () => {
  it('A 09:00–09:30 com intervalo de 10 min: B às 09:30 recusado; às 09:40 aceito', async () => {
    const c = await criarCenarioReserva({ intervaloMin: 10, gradeMin: 10 });
    await semEfeito(c, async () => {
      const r = await criarReserva(c.ctxSistema, entradaReserva(c, { itens: [item(c, sp(DIA, '09:00')), item(c, sp(DIA, '09:30'), { servicoId: c.B })] }), {
        enfileirar,
      });
      expect(r).toEqual({ resultado: 'horario_indisponivel', causa: 'entre_itens', itens: [1], conflitos: { 1: 0 } });
    });
    const ok = await criarReserva(c.ctxSistema, entradaReserva(c, { itens: [item(c, sp(DIA, '09:00')), item(c, sp(DIA, '09:40'), { servicoId: c.B })] }), {
      enfileirar,
    });
    expect(ok.resultado).toBe('criada');
    if (ok.resultado !== 'criada') return;
    expect(ok.reserva.itens.map((i) => [i.inicio, i.fim, i.ocupadoAte])).toEqual([
      [sp(DIA, '09:00'), sp(DIA, '09:30'), sp(DIA, '09:40')],
      [sp(DIA, '09:40'), sp(DIA, '10:25'), sp(DIA, '10:35')],
    ]);
    await conferirDerivados(ok.reserva.id);
  });

  it('intervalo não vale entre profissionais diferentes: A (Bia) 09:00–09:30 e B (Ana) às 09:30 aceito', async () => {
    const c = await criarCenarioReserva({ intervaloMin: 10, gradeMin: 10 });
    await jornadaDaBia(c);
    const r = await criarReserva(
      c.ctxSistema,
      entradaReserva(c, { itens: [item(c, sp(DIA, '09:00'), { profissionalId: c.bia }), item(c, sp(DIA, '09:30'), { servicoId: c.B })] }),
      { enfileirar },
    );
    expect(r.resultado).toBe('criada');
  });
});

describe('CA-7 (RN-3): todos os itens na mesma data local', () => {
  it('item em outra data: invalido com a mensagem no índice dele, nada gravado (público e equipe)', async () => {
    const c = await criarCenarioReserva();
    await semEfeito(c, async () => {
      for (const [ctx, modo] of [
        [c.ctxSistema, 'normal'],
        [c.ctxEquipe, 'encaixe'],
      ] as const) {
        const r = await criarReserva(
          ctx,
          entradaReserva(c, { modo, itens: [item(c, sp(DIA, '10:00')), item(c, sp(DIA_SEGUINTE, '10:00'), { servicoId: c.B })] }),
          { enfileirar },
        );
        expect(r).toEqual({ resultado: 'invalido', erros: { porItem: { 1: { inicio: MENSAGENS_RESERVA.dataDiferente } } } });
      }
    });
  });

  it('23:30 e 00:00 locais são datas diferentes, mesmo com 30 min de distância', async () => {
    const c = await criarCenarioReserva({ jornada: [['00:00', '24:00']] });
    const r = await criarReserva(
      c.ctxEquipe,
      entradaReserva(c, { modo: 'encaixe', itens: [item(c, sp(DIA, '23:00')), item(c, sp(DIA_SEGUINTE, '00:00'), { servicoId: c.B })] }),
      { enfileirar },
    );
    expect(r.resultado).toBe('invalido');
  });
});

describe('revalidação e indisponibilidade por item (índices)', () => {
  it('só o item cujo horário foi ocupado falha; os outros não aparecem', async () => {
    const c = await criarCenarioReserva();
    await jornadaDaBia(c);
    await db().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: c.ana, inicio: sp(DIA, '14:00'), fim: sp(DIA, '15:00') } });
    await semEfeito(c, async () => {
      const r = await criarReserva(
        c.ctxSistema,
        entradaReserva(c, { itens: [item(c, sp(DIA, '10:00'), { profissionalId: c.bia }), item(c, sp(DIA, '14:00'), { servicoId: c.B })] }),
        { enfileirar },
      );
      expect(r).toEqual(revalidacao(1));
    });
  });

  it('todos os itens que falham são listados', async () => {
    const c = await criarCenarioReserva();
    await semEfeito(c, async () => {
      const r = await criarReserva(
        c.ctxSistema,
        entradaReserva(c, { itens: [item(c, sp(DIA, '10:07')), item(c, sp(DIA, '20:00'), { servicoId: c.B })] }),
        { enfileirar },
      );
      expect(r).toEqual(revalidacao(0, 1));
    });
  });

  it('profissional sem vínculo com o serviço DO ITEM: profissional_indisponivel com o índice', async () => {
    const c = await criarCenarioReserva();
    await jornadaDaBia(c);
    await semEfeito(c, async () => {
      const r = await criarReserva(
        c.ctxSistema,
        entradaReserva(c, { itens: [item(c, sp(DIA, '10:00')), item(c, sp(DIA, '11:00'), { servicoId: c.B, profissionalId: c.bia })] }),
        { enfileirar },
      );
      expect(r).toEqual({ resultado: 'profissional_indisponivel', itens: [1] });
    });
  });

  it('profissional inativo e de outro salão: os índices dos itens afetados', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    await semEfeito(c, async () => {
      const r = await criarReserva(
        c.ctxSistema,
        entradaReserva(c, {
          itens: [
            item(c, sp(DIA, '10:00'), { profissionalId: c.s.profissionalInativoId }),
            item(c, sp(DIA, '11:00'), { servicoId: c.B }),
          ],
        }),
        { enfileirar },
      );
      expect(r).toEqual({ resultado: 'profissional_indisponivel', itens: [0] });
      const r2 = await criarReserva(
        c.ctxSistema,
        entradaReserva(c, { itens: [item(c, sp(DIA, '10:00')), item(c, sp(DIA, '11:00'), { servicoId: c.B, profissionalId: outro.ana })] }),
        { enfileirar },
      );
      expect(r2).toEqual({ resultado: 'profissional_indisponivel', itens: [1] });
    });
  });

  it('um serviço inativo na reserva: servico_indisponivel, nada gravado', async () => {
    const c = await criarCenarioReserva();
    await db().servico.update({ where: { id: c.B }, data: { ativo: false } });
    await semEfeito(c, async () => {
      const r = await criarReserva(c.ctxSistema, entradaReserva(c, { itens: [item(c, sp(DIA, '10:00')), item(c, sp(DIA, '11:00'), { servicoId: c.B })] }), {
        enfileirar,
      });
      expect(r).toEqual({ resultado: 'servico_indisponivel' });
    });
  });
});

describe('CA-6: três itens, três profissionais, manhã e tarde', () => {
  it('1 reserva com 3 itens (cada um com seu profissional, horário e snapshot), 1 consentimento por finalidade, 1 confirmação', async () => {
    const c = await criarCenarioReserva();
    await jornadaDaBia(c);
    const carla = (await db().profissional.create({ data: { salaoId: c.s.salaoId, nome: 'Carla' }, select: { id: true } })).id;
    const C = (await db().servico.create({ data: { salaoId: c.s.salaoId, nome: 'C', precoCentavos: 4500, duracaoMin: 45 }, select: { id: true } })).id;
    await db().servicoProfissional.create({ data: { salaoId: c.s.salaoId, servicoId: C, profissionalId: carla } });
    await jornadaDaBia(c);
    await db().jornada.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ salaoId: c.s.salaoId, profissionalId: carla, diaSemana, inicioMin: 540, fimMin: 1140 })),
    });
    const antes = await contarLinhas(c.s.salaoId);
    const r = await criarReserva(
      c.ctxSistema,
      entradaReserva(c, {
        aceites: { mensagensReserva: true, conviteAvaliacao: true },
        itens: [
          item(c, sp(DIA, '09:00'), { profissionalId: c.bia }),
          item(c, sp(DIA, '10:00'), { servicoId: c.B }),
          item(c, sp(DIA, '15:00'), { servicoId: C, profissionalId: carla }),
        ],
      }),
      { enfileirar },
    );
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    expect(r.reserva.itens.map((i) => [i.servicoId, i.profissionalId, i.inicio, i.fim, i.precoCentavos, i.status])).toEqual([
      [c.A, c.bia, sp(DIA, '09:00'), sp(DIA, '09:30'), 5000, 'confirmado'],
      [c.B, c.ana, sp(DIA, '10:00'), sp(DIA, '10:45'), 7000, 'confirmado'],
      [C, carla, sp(DIA, '15:00'), sp(DIA, '15:45'), 4500, 'confirmado'],
    ]);
    expect(await contarLinhas(c.s.salaoId)).toEqual({
      ...antes,
      reserva: 1,
      itens: 3,
      cliente: antes.cliente + 1,
      consentimento: 2,
      mensagem: 1,
    });
    const m = await db().mensagem.findFirstOrThrow({ where: { reservaId: r.reserva.id } });
    expect(m).toMatchObject({ tipo: 'confirmacao', revisao: 0, reservaItemId: null });
    await conferirDerivados(r.reserva.id);
  });
});
