import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReserva } from '@/server/reservas/criar-reserva';
import type { ResultadoCriarReserva } from '@/server/reservas/tipos';
import { obterPrisma } from '@/server/repos/db';

import {
  criarBarreira,
  criarCenarioReserva,
  definirJornada,
  entradaReserva,
  instalarPoolDedicado,
  sp,
} from '../../support/reservas';
import type { CenarioReserva, DataCivil } from '../../support/reservas';
import { conectar } from '../../support/sql';

// D-025 T-6d (CA-29, DEF-1): regressão do 40P01 dos speculative tokens do ON CONFLICT + exclusion.
// 2 cópias (uma por profissional) × 12 transações simultâneas por horário × 30 horários × 3 ondas
// (2160 requisições) + uma onda de 16 transações em 5 horários. Pool PRÓPRIO de 24 conexões (dentro de
// max_connections = 100). Largada simultânea por barreira FORA da trava (aposRevalidar não sincroniza).

const TRANSACOES = 12;
const HORARIOS = 30;
const DIAS: DataCivil[] = [
  { ano: 2026, mes: 12, dia: 1 },
  { ano: 2026, mes: 12, dia: 2 },
  { ano: 2026, mes: 12, dia: 3 },
];
const DIA_DA_ONDA_16: DataCivil = { ano: 2026, mes: 12, dia: 4 };
const TETO_POR_ONDA_MS = 20_000;
const enfileirar = async () => ({ criado: true as const, id: 'job' });

let pool: { encerrar(): Promise<void> };
beforeAll(async () => {
  const c = await conectar();
  try {
    const { rows } = await c.query<{ max: number }>(`SELECT current_setting('max_connections')::int AS max`);
    if (rows[0].max < 60) throw new Error(`max_connections = ${rows[0].max}: o teste de carga exige pelo menos 60`);
  } finally {
    await c.end();
  }
  pool = instalarPoolDedicado(24);
});
afterAll(async () => {
  await pool?.encerrar();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

const hora = (i: number): string => {
  const minutos = 6 * 60 + 30 * i;
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
};

type Coleta = { rejeicoes: unknown[]; porHorario: Map<string, ResultadoCriarReserva[]> };

/** 12 (ou n) criações concorrentes no mesmo horário e profissional. */
async function rajada(cen: CenarioReserva, profissionalId: string, inicio: Date, n: number): Promise<{ ok: ResultadoCriarReserva[]; rejeicoes: unknown[] }> {
  const largada = criarBarreira(n);
  const r = await Promise.allSettled(
    Array.from({ length: n }, async () => {
      await largada();
      return criarReserva(cen.ctxSistema, entradaReserva(cen, { profissionalId, inicio }), { enfileirar });
    }),
  );
  return {
    ok: r.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : [])),
    rejeicoes: r.flatMap((x) => (x.status === 'rejected' ? [x.reason] : [])),
  };
}

function conferir(coleta: Coleta, n: number): void {
  expect(coleta.rejeicoes).toEqual([]);
  for (const [chave, rs] of coleta.porHorario) {
    expect(rs, chave).toHaveLength(n);
    expect(rs.filter((r) => r.resultado === 'criada'), chave).toHaveLength(1);
    // Nenhum 40P01, 23505 ou erro: só a perdedora por revalidação (a trava serializa as criações).
    expect(rs.filter((r) => r.resultado !== 'criada'), chave).toEqual(Array(n - 1).fill({ resultado: 'horario_indisponivel', causa: 'revalidacao' }));
  }
}

describe('CA-29 (DEF-1): criações concorrentes no mesmo horário resistem à carga', () => {
  it(
    '2 cópias × 12 transações × 30 horários × 3 ondas, mais uma onda de 16',
    async () => {
      const cen = await criarCenarioReserva();
      const db = obterPrisma();
      await definirJornada(cen.s.salaoId, cen.ana, [['00:00', '24:00']]);
      await definirJornada(cen.s.salaoId, cen.bia, [['00:00', '24:00']]);
      const antes = {
        cliente: await db.cliente.count({ where: { salaoId: cen.s.salaoId } }),
      };

      let criadas = 0;
      const todas: Coleta = { rejeicoes: [], porHorario: new Map() };
      for (const [n, dia] of DIAS.entries()) {
        const inicioOnda = Date.now();
        const copia = async (profissionalId: string): Promise<Coleta> => {
          const coleta: Coleta = { rejeicoes: [], porHorario: new Map() };
          for (let i = 0; i < HORARIOS; i++) {
            const r = await rajada(cen, profissionalId, sp(dia, hora(i)), TRANSACOES);
            coleta.rejeicoes.push(...r.rejeicoes);
            coleta.porHorario.set(`${profissionalId}@onda${n}@${hora(i)}`, r.ok);
          }
          return coleta;
        };
        const [a, b] = await Promise.all([copia(cen.ana), copia(cen.bia)]);
        const onda: Coleta = { rejeicoes: [...a.rejeicoes, ...b.rejeicoes], porHorario: new Map([...a.porHorario, ...b.porHorario]) };
        conferir(onda, TRANSACOES);
        expect(Date.now() - inicioOnda, `onda ${n}`).toBeLessThan(TETO_POR_ONDA_MS);
        criadas += onda.porHorario.size;
        todas.rejeicoes.push(...onda.rejeicoes);
      }

      // Onda de 16 transações em 5 horários (o ponto que o DBA não mediu).
      const onda16: Coleta = { rejeicoes: [], porHorario: new Map() };
      for (let i = 0; i < 5; i++) {
        const r = await rajada(cen, cen.ana, sp(DIA_DA_ONDA_16, hora(i)), 16);
        onda16.rejeicoes.push(...r.rejeicoes);
        onda16.porHorario.set(`16@${hora(i)}`, r.ok);
      }
      conferir(onda16, 16);
      criadas += onda16.porHorario.size;

      expect(criadas).toBe(2 * HORARIOS * DIAS.length + 5);
      const reservas = await db.reserva.findMany({ where: { salaoId: cen.s.salaoId, status: 'confirmado' }, select: { profissionalId: true, inicio: true } });
      expect(reservas).toHaveLength(criadas);
      expect(new Set(reservas.map((r) => `${r.profissionalId}@${r.inicio.toISOString()}`)).size).toBe(criadas);
      expect(await db.reservaItem.count({ where: { salaoId: cen.s.salaoId } })).toBe(criadas);
      expect(await db.consentimento.count({ where: { salaoId: cen.s.salaoId } })).toBe(criadas);
      expect(await db.mensagem.count({ where: { salaoId: cen.s.salaoId } })).toBe(criadas);
      // Cada requisição usa um telefone novo, mas só as vencedoras mantêm a cliente (as demais desfeitas).
      expect(await db.cliente.count({ where: { salaoId: cen.s.salaoId } })).toBe(antes.cliente + criadas);
    },
    120_000,
  );
});
