import { describe, expect, it } from 'vitest';

import { montarSemana } from '@/server/semana/montagem';

import { montarVista } from './montagem';
import type { EntradaDaVista } from './montagem';
import type { ReservaDaAgenda } from './tipos';

// D-028 T-1 (RN-8, RN-9, RN-12): quais colunas aparecem, bloqueios do salão replicados, faixas por dia.
const SP = 'America/Sao_Paulo';
const HOJE = { ano: 2026, mes: 12, dia: 1 };
const ANA = { id: 'ana', nome: 'Ana', ativo: true };
const BIA = { id: 'bia', nome: 'Bia', ativo: true };
const CARLA = { id: 'carla', nome: 'Carla', ativo: false };
const jornada = montarSemana([1, 2, 3, 4, 5, 6, 0].map((diaSemana) => ({ diaSemana, inicioMin: 540, fimMin: 1080 })));
const reserva = (profissionalId: string): ReservaDaAgenda => ({
  id: `r-${profissionalId}`,
  profissionalId,
  inicio: new Date('2026-12-01T13:00:00Z'),
  fim: new Date('2026-12-01T14:00:00Z'),
  status: 'confirmado',
  origem: 'equipe',
  encaixe: false,
  clienteNome: 'X',
  itens: [],
});
const base: EntradaDaVista = {
  data: HOJE,
  visao: 'dia',
  fuso: SP,
  hoje: HOJE,
  profissionais: [ANA, BIA, CARLA],
  filtro: null,
  colunaSempre: false,
  comOpcoes: true,
  reservas: [],
  bloqueios: [],
  jornadas: new Map([[ANA.id, jornada]]),
  funcionamento: { definido: false },
  truncada: false,
};

describe('montarVista', () => {
  it('sem filtro: ativo com jornada, quem tem reserva ou bloqueio próprio; inativo vazio é omitido', () => {
    const v = montarVista({
      ...base,
      reservas: [reserva(CARLA.id)],
      bloqueios: [{ id: 'b1', profissionalId: BIA.id, inicio: new Date('2026-12-01T13:00:00Z'), fim: new Date('2026-12-01T14:00:00Z'), motivo: 'm' }],
    });
    expect(v.colunas.map((c) => c.id)).toEqual(['ana', 'bia', 'carla']);
    const sem = montarVista(base);
    expect(sem.colunas.map((c) => c.id)).toEqual(['ana']);
    expect(montarVista({ ...base, profissionais: [CARLA] }).colunas).toEqual([]);
  });

  it('bloqueio do salão vale para todas as colunas; o próprio só para o dono', () => {
    const salao = { id: 'bs', profissionalId: null, inicio: new Date('2026-12-01T13:00:00Z'), fim: new Date('2026-12-01T14:00:00Z'), motivo: 'Feriado' };
    const propio = { ...salao, id: 'bp', profissionalId: ANA.id, motivo: null };
    const v = montarVista({ ...base, colunaSempre: true, profissionais: [ANA, BIA], bloqueios: [propio, salao] });
    expect(v.colunas[0].bloqueios.map((b) => b.id).sort()).toEqual(['bp', 'bs']);
    expect(v.colunas[1].bloqueios.map((b) => b.id)).toEqual(['bs']);
  });

  it('filtro: só a coluna escolhida, mesmo vazia; opções só com comOpcoes', () => {
    const v = montarVista({ ...base, filtro: BIA.id, colunaSempre: true });
    expect(v.colunas.map((c) => c.id)).toEqual(['bia']);
    expect(v.profissionalFiltro).toBe('bia');
    expect(v.profissionais).toHaveLength(3);
    expect(montarVista({ ...base, comOpcoes: false }).profissionais).toEqual([]);
  });

  it('faixas: salão fechado no domingo; fora da jornada sem repetir o fechado; sem jornada = tudo', () => {
    const func = { definido: true, semana: montarSemana([1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicioMin: 480, fimMin: 1200 }))) } as const;
    const v = montarVista({ ...base, data: { ano: 2026, mes: 12, dia: 6 }, funcionamento: func, colunaSempre: true, profissionais: [ANA, BIA] });
    expect(v.dias[0].salaoFechado).toBe(true);
    const terca = montarVista({ ...base, funcionamento: func, colunaSempre: true, profissionais: [ANA, BIA] });
    expect(terca.dias[0].salaoFechado).toBe(false);
    expect(terca.colunas[0].foraDaJornada['2026-12-01']).toEqual([{ inicioMin: 480, fimMin: 540 }, { inicioMin: 1080, fimMin: 1200 }]);
    expect(terca.colunas[1].foraDaJornada['2026-12-01']).toEqual([{ inicioMin: 480, fimMin: 1200 }]);
  });

  it('semana: 7 dias, datas de navegação e truncada repassada', () => {
    const v = montarVista({ ...base, visao: 'semana', truncada: true });
    expect(v.dias).toHaveLength(7);
    expect(v.data).toBe('2026-12-01');
    expect([v.anterior, v.proximo, v.hoje]).toEqual(['2026-11-24', '2026-12-08', '2026-12-01']);
    expect(v.truncada).toBe(true);
  });
});
