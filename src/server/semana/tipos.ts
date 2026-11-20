// Núcleo da semana horária (D-020 §3.1, extraído da jornada D-015). Arquivo SEM imports de servidor
// de runtime: os componentes cliente o importam (só tipos e constantes). Usado pela jornada do
// profissional (src/server/jornadas/, fachadas) e pelo funcionamento do salão (src/server/salao/).
//
// Hora LOCAL de parede do salão em minutos do dia: sem conversão para UTC ao gravar nem ao exibir.
// `diaSemana`: 0 = domingo … 6 = sábado (como Date#getDay e EXTRACT(DOW)). Intervalos semiabertos
// [início, fim), 0 ≤ início < fim ≤ 1440.

export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const DIAS_SEMANA: readonly DiaSemana[] = Object.freeze([0, 1, 2, 3, 4, 5, 6] as DiaSemana[]);
/** Exibição de segunda a domingo. */
export const ORDEM_EXIBICAO_DIAS: readonly DiaSemana[] = Object.freeze([1, 2, 3, 4, 5, 6, 0] as DiaSemana[]);

export const LIMITES_SEMANA = Object.freeze({
  /** Máximo de intervalos por dia. */
  intervalosPorDia: 6,
  /** Linhas fixas do formulário (= intervalosPorDia). */
  linhasPorDia: 6,
  /** Teto do array por dia na ação (anti-payload); acima → formulario. */
  linhasRecebidasMax: 20,
  /** Passo dos horários, em minutos. */
  passoMin: 5,
  /** 24:00. */
  fimMax: 1440,
  /** Texto bruto antes da regex. */
  horarioMaxCaracteres: 10,
});

export type IntervaloMin = { inicioMin: number; fimMin: number };
export type DiaSemanaHoraria = { diaSemana: DiaSemana; intervalos: IntervaloMin[]; pausas: IntervaloMin[] };
/** Sempre 7 itens, índice = diaSemana (0..6); intervalos canônicos (ordenados, sem sobreposição nem contiguidade). */
export type SemanaHoraria = readonly DiaSemanaHoraria[];

export type ErroIntervalo = { inicio?: string; fim?: string; intervalo?: string };
export type ErrosDia = { dia?: string; intervalos?: Partial<Record<number, ErroIntervalo>> };
export type ErrosSemana = { formulario?: string; dias?: Partial<Record<DiaSemana, ErrosDia>> };

/** Linha bruta: textos "HH:MM" (vazios permitidos). Índice da linha = posição no array. */
export type LinhaEntrada = { inicio?: string; fim?: string };
export type DiaEntrada = { diaSemana: number; intervalos: LinhaEntrada[] };

/** Textos genéricos de intervalo (os mesmos da jornada, caractere a caractere). */
export const MENSAGENS_INTERVALO = Object.freeze({
  formato: 'Use o formato HH:MM, de 00:00 a 24:00 (ex.: 09:00).',
  granularidade: 'Use minutos múltiplos de 5 (ex.: 09:05).',
  inicio24: 'O início vai até 23:55. 24:00 só pode ser fim.',
  faltaInicio: 'Informe também o início.',
  faltaFim: 'Informe também o fim.',
  ordem:
    'O fim precisa ser depois do início. Para passar da meia-noite, termine às 24:00 e continue no dia seguinte a partir de 00:00.',
  sobreposicao: 'Este intervalo se sobrepõe a outro do mesmo dia.',
  limite: 'Use no máximo 6 intervalos por dia.',
  formulario: 'Não foi possível ler os dados enviados. Recarregue a página e tente de novo.',
  ajudaHorario:
    'Horário local do salão, no formato HH:MM, em múltiplos de 5 minutos. Use 24:00 para meia-noite no fim do dia. Linhas vazias são ignoradas.',
});
