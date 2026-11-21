// Tipos da entrada e da saída do cálculo de disponibilidade (D-018 §3.1). Domínio puro: sem banco,
// sem next/*, sem relógio implícito. A única importação de fora da pasta é `@/server/tempo/fuso`.
import type { DataCivil } from '@/server/tempo/fuso';

export type { DataCivil };

/** Semiaberto [inicio, fim), instantes UTC. */
export type Intervalo = { readonly inicio: Date; readonly fim: Date };

/** Semiaberto [inicioMin, fimMin), minutos de parede do dia local (0..1440). */
export type IntervaloMin = { readonly inicioMin: number; readonly fimMin: number };

export type RegrasDeAgenda = {
  /** `validarFuso` (aceita alias antigo; nunca `ehFusoCanonico`). */
  readonly fuso: string;
  /** Inteiro 1..1440. */
  readonly gradeMin: number;
  /** Inteiro >= 0, em minutos. */
  readonly antecedenciaMin: number;
  /** Inteiro >= 0. */
  readonly janelaDias: number;
  /** Inteiro >= 0. */
  readonly intervaloMin: number;
};

/** 0 = domingo; 0 <= inicioMin < fimMin <= 1440. */
export type LinhaDeJornada = { readonly diaSemana: number; readonly inicioMin: number; readonly fimMin: number };

export type AgendaDoProfissional = {
  readonly profissionalId: string;
  readonly jornada: readonly LinhaDeJornada[];
  /** Só os do profissional. */
  readonly bloqueios: readonly Intervalo[];
  /** [r.inicio, r.ocupado_ate) das reservas ativas. */
  readonly ocupacoes: readonly Intervalo[];
};

/** Hora de parede local, minutos do dia, índice = dia da semana (0 = domingo). `definido: false` não limita. */
export type FuncionamentoDeAgenda =
  | { readonly definido: false }
  | { readonly definido: true; readonly dias: readonly (readonly IntervaloMin[])[] };

export type EntradaDeCalculo = {
  readonly agora: Date;
  readonly regras: RegrasDeAgenda;
  readonly funcionamento: FuncionamentoDeAgenda;
  /** Inteiro > 0 (soma das durações). */
  readonly duracaoMin: number;
  /** Em ordem crescente, sem repetição. */
  readonly datas: readonly DataCivil[];
  /** `profissional_id` nulo: valem para todos. */
  readonly bloqueiosDoSalao: readonly Intervalo[];
  readonly profissionais: readonly AgendaDoProfissional[];
};

export type HorarioOferecido = {
  readonly inicio: Date;
  /** inicio + duracaoMin (tempo real). */
  readonly fim: Date;
  readonly local: { readonly data: DataCivil; readonly minutosDoDia: number };
};

export type DiaDeDisponibilidade = { readonly data: DataCivil; readonly horarios: readonly HorarioOferecido[] };

export type DisponibilidadeCalculada = ReadonlyArray<{
  readonly profissionalId: string;
  readonly dias: readonly DiaDeDisponibilidade[];
}>;
