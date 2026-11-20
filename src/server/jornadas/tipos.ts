// Contratos da jornada semanal (D-015 §3.1). Arquivo SEM imports de servidor de runtime: os
// componentes cliente o importam (só tipos e constantes). Os resultados de negócio são discriminados
// por `resultado` dentro de `{ ok: true, dados }`; ErroDeDominio continua só com 401/403/404.
//
// A jornada é hora LOCAL de parede do salão em minutos do dia (RN-10): sem conversão para UTC ao
// gravar nem ao exibir. `diaSemana`: 0 = domingo … 6 = sábado (RN-15, como Date#getDay e
// EXTRACT(DOW)). Intervalos semiabertos [início, fim), 0 ≤ início < fim ≤ 1440 (RN-3).

export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const DIAS_SEMANA: readonly DiaSemana[] = Object.freeze([0, 1, 2, 3, 4, 5, 6] as DiaSemana[]);
/** Exibição de segunda a domingo (RN-15). */
export const ORDEM_EXIBICAO_DIAS: readonly DiaSemana[] = Object.freeze([1, 2, 3, 4, 5, 6, 0] as DiaSemana[]);

export const LIMITES_JORNADA = Object.freeze({
  /** RN-7 (D-4). */
  intervalosPorDia: 6,
  /** Linhas fixas do formulário (= intervalosPorDia). */
  linhasPorDia: 6,
  /** Teto do array por dia na ação (anti-payload); acima → formulario. */
  linhasRecebidasMax: 20,
  /** RN-4 (D-1). */
  passoMin: 5,
  /** RN-3: 24:00. */
  fimMax: 1440,
  /** Texto bruto antes da regex. */
  horarioMaxCaracteres: 10,
});

export type IntervaloMin = { inicioMin: number; fimMin: number };
export type DiaJornada = { diaSemana: DiaSemana; intervalos: IntervaloMin[]; pausas: IntervaloMin[] };
/** Sempre 7 itens, índice = diaSemana (0..6); intervalos canônicos (RN-5). */
export type SemanaJornada = readonly DiaJornada[];

export type ErroIntervalo = { inicio?: string; fim?: string; intervalo?: string };
export type ErrosDia = { dia?: string; intervalos?: Partial<Record<number, ErroIntervalo>> };
export type ErrosJornada = { formulario?: string; dias?: Partial<Record<DiaSemana, ErrosDia>> };

/** Linha bruta: textos "HH:MM" (vazios permitidos). Índice da linha = posição no array. */
export type LinhaEntrada = { inicio?: string; fim?: string };
export type DiaEntrada = { diaSemana: number; intervalos: LinhaEntrada[] };
export type EntradaSalvarJornada = { profissionalId: unknown; dias: unknown };

export type ResultadoSalvarJornada =
  | { resultado: 'salvo'; semana: SemanaJornada; inseridos: number; removidos: number }
  | { resultado: 'invalido'; erros: ErrosJornada };

export type JornadaVisao = {
  profissional: { id: string; nome: string; ativo: boolean };
  semana: SemanaJornada;
  /** RN-8 / CA-15. */
  semIntervalos: boolean;
  /** pode(ctx.papel, 'jornada.editar') === 'salao'. */
  editavel: boolean;
};

export const MENSAGENS_JORNADA = Object.freeze({
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
  resumoErros: 'Corrija os campos indicados para salvar a jornada.',
  ajudaHorario:
    'Horário local do salão, no formato HH:MM, em múltiplos de 5 minutos. Use 24:00 para meia-noite no fim do dia. Linhas vazias são ignoradas.',
  salva: 'Jornada salva.',
  /** Só na página de demonstração /dev/jornada (D-11). */
  demonstracao: 'Jornada válida (demonstração: nada foi gravado).',
  semIntervalos: 'Sem nenhum intervalo na semana, este profissional não terá horários disponíveis para reserva.',
  inativo: 'Profissional inativo: esta jornada só passa a valer quando ele for reativado.',
  somenteLeitura: 'Só o gestor do salão altera a jornada.',
  folga: 'Folga',
  naoEncontrado: 'Profissional não encontrado.',
  acessoNegado: 'Acesso negado.',
});
