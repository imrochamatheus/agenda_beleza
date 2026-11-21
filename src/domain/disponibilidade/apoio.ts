// Apoio dos testes unitários do domínio (não é código de produção; só os *.test.ts o importam).
import type { DataCivil } from '@/server/tempo/fuso';

import type {
  AgendaDoProfissional,
  DisponibilidadeCalculada,
  EntradaDeCalculo,
  FuncionamentoDeAgenda,
  Intervalo,
  IntervaloMin,
  LinhaDeJornada,
  RegrasDeAgenda,
} from './tipos';

export const D = (ano: number, mes: number, dia: number): DataCivil => ({ ano, mes, dia });

/** 'HH:MM' → minutos do dia. */
export const mm = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const rotulo = (minutos: number): string =>
  `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;

/** Instante de uma hora local de `America/Sao_Paulo` em 2026-2027 (UTC−3 fixo, sem horário de verão). */
export const sp = (d: DataCivil, hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(d.ano, d.mes - 1, d.dia, h + 3, m));
};
export const iso = (s: string): Date => new Date(s);
export const intervalo = (inicio: Date, fim: Date): Intervalo => ({ inicio, fim });

export const REGRAS_SP: RegrasDeAgenda = {
  fuso: 'America/Sao_Paulo',
  gradeMin: 15,
  antecedenciaMin: 120,
  janelaDias: 60,
  intervaloMin: 0,
};

/** 20/11/2026 09:00 local de São Paulo. */
export const AGORA = new Date('2026-11-20T12:00:00Z');
/** Terça-feira, dentro da janela. */
export const DIA = D(2026, 12, 1);

export const todosOsDias = (ini: string, fim: string): LinhaDeJornada[] =>
  [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicioMin: mm(ini), fimMin: mm(fim) }));

export const jornada = (diaSemana: number, ...faixas: [string, string][]): LinhaDeJornada[] =>
  faixas.map(([i, f]) => ({ diaSemana, inicioMin: mm(i), fimMin: mm(f) }));

export const semana = (porDia: Partial<Record<number, [string, string][]>>): FuncionamentoDeAgenda => ({
  definido: true,
  dias: [0, 1, 2, 3, 4, 5, 6].map((w): IntervaloMin[] => (porDia[w] ?? []).map(([i, f]) => ({ inicioMin: mm(i), fimMin: mm(f) }))),
});
export const funcionamentoTodosOsDias = (...faixas: [string, string][]): FuncionamentoDeAgenda =>
  semana(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((w) => [w, faixas])));

export const prof = (
  id: string,
  linhas: LinhaDeJornada[],
  extras: Partial<Pick<AgendaDoProfissional, 'bloqueios' | 'ocupacoes'>> = {},
): AgendaDoProfissional => ({ profissionalId: id, jornada: linhas, bloqueios: [], ocupacoes: [], ...extras });

export function entrada(parcial: Partial<EntradaDeCalculo> & Pick<EntradaDeCalculo, 'profissionais'>): EntradaDeCalculo {
  return {
    agora: AGORA,
    regras: REGRAS_SP,
    funcionamento: { definido: false },
    duracaoMin: 60,
    datas: [DIA],
    bloqueiosDoSalao: [],
    ...parcial,
  };
}

/** Rótulos locais 'HH:MM' dos inícios do profissional `idx` na data `dia` do resultado. */
export function inicios(res: DisponibilidadeCalculada, idx = 0, dia = 0): string[] {
  return res[idx].dias[dia].horarios.map((h) => rotulo(h.local.minutosDoDia));
}

/** 'HH:MM' de a até b (inclusive) de 15 em 15 (ou `passo`). */
export function faixa(a: string, b: string, passo = 15): string[] {
  const r: string[] = [];
  for (let m = mm(a); m <= mm(b); m += passo) r.push(rotulo(m));
  return r;
}
