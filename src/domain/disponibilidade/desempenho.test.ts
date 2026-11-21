import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/tempo/fuso', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/tempo/fuso')>();
  return {
    ...original,
    instanteDeHoraLocal: vi.fn(original.instanteDeHoraLocal),
    partesLocais: vi.fn(original.partesLocais),
  };
});

import * as fuso from '@/server/tempo/fuso';

import { calcularDisponibilidade } from './calcular';
import { AGORA, D, REGRAS_SP, entrada, funcionamentoTodosOsDias, intervalo, prof, todosOsDias } from './apoio';
import type { AgendaDoProfissional, DataCivil, FuncionamentoDeAgenda } from './tipos';

const MS_DIA = 86_400_000;
// Mocks de módulo de tempo apenas: o domínio é puro e não há banco aqui.

function datas(n: number): DataCivil[] {
  const base = Date.UTC(2026, 10, 20);
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(base + i * MS_DIA);
    return D(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  });
}

function profissionais(n: number, ocupacoesPorProf: number): AgendaDoProfissional[] {
  const inicioBase = Date.UTC(2026, 10, 20, 3);
  return Array.from({ length: n }, (_, p) =>
    prof(`p${p}`, todosOsDias('00:00', '24:00'), {
      // 500 ocupações de 30 min espalhadas por ~61 dias (uma a cada 2 h 55 min, deslocada por profissional).
      ocupacoes: Array.from({ length: ocupacoesPorProf }, (_, k) => {
        const i = inicioBase + (k * 175 + p * 7) * 60_000;
        return intervalo(new Date(i), new Date(i + 30 * 60_000));
      }),
    }),
  );
}

const cenario = (n: number, funcionamento: FuncionamentoDeAgenda) =>
  entrada({
    agora: AGORA,
    regras: { ...REGRAS_SP, gradeMin: 5 },
    duracaoMin: 30,
    datas: datas(61),
    funcionamento,
    profissionais: profissionais(n, 500),
  });

const chamadas = () => vi.mocked(fuso.instanteDeHoraLocal).mock.calls.length;
const FUNC: FuncionamentoDeAgenda = funcionamentoTodosOsDias(['08:00', '12:00'], ['13:00', '20:00']);
const NAO_INFORMADO: FuncionamentoDeAgenda = { definido: false };

beforeEach(() => {
  vi.mocked(fuso.instanteDeHoraLocal).mockClear();
  vi.mocked(fuso.partesLocais).mockClear();
});

describe('desempenho (CA-27)', () => {
  it('10 profissionais × 61 datas, grade 5, 500 ocupações cada: < 2 s', () => {
    const e = cenario(10, NAO_INFORMADO);
    calcularDisponibilidade(cenario(1, NAO_INFORMADO)); // aquecimento (Intl)
    const t0 = performance.now();
    const r = calcularDisponibilidade(e);
    const ms = performance.now() - t0;
    console.log(`[CA-27] sem funcionamento: ms=${ms.toFixed(0)}`);
    expect(r).toHaveLength(10);
    expect(r[0].dias).toHaveLength(61);
    expect(r[0].dias[1].horarios.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  }, 30_000);

  it('o mesmo com funcionamento informado (com pausas): < 2 s', () => {
    const e = cenario(10, FUNC);
    calcularDisponibilidade(cenario(1, FUNC));
    const t0 = performance.now();
    const r = calcularDisponibilidade(e);
    const ms = performance.now() - t0;
    console.log(`[CA-27] com funcionamento: ms=${ms.toFixed(0)}`);
    expect(r[0].dias[1].horarios.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  }, 30_000);
});

describe('contador estrutural: a conversão de fuso não depende do número de profissionais', () => {
  for (const [nome, f] of [['sem funcionamento', NAO_INFORMADO], ['com funcionamento', FUNC]] as const) {
    it(nome, () => {
      calcularDisponibilidade(cenario(1, f));
      const com1 = chamadas();
      vi.mocked(fuso.instanteDeHoraLocal).mockClear();
      calcularDisponibilidade(cenario(10, f));
      const com10 = chamadas();
      expect(com1).toBeGreaterThan(0);
      expect(com10).toBe(com1);
      expect(vi.mocked(fuso.partesLocais).mock.calls.length).toBeGreaterThan(0);
    }, 30_000);
  }
});
