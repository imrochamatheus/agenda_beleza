// Contratos dos bloqueios (D-016 §3.2). Arquivo SEM imports de servidor de runtime: os componentes
// cliente o importam (só tipos e constantes). Os resultados de negócio são discriminados por
// `resultado` dentro de `{ ok: true, dados }`; ErroDeDominio continua só com 401/403/404.
//
// Bloqueio = intervalo semiaberto [inicio, fim) de instantes UTC, informado e exibido no fuso do salão
// (RN-1); profissional_id nulo = salão inteiro.

export const LIMITES_BLOQUEIO = Object.freeze({
  /** RN-4 (D-3). */
  passoMin: 5,
  /** RN-7, modo com horário (medido em UTC). */
  duracaoMaxMs: 366 * 24 * 60 * 60_000,
  /** RN-7, modo dia inteiro (número de datas). */
  diasInteirosMax: 366,
  /** RN-7: "2 anos" = 730 × 24 h (D-15). */
  antecedenciaMaxMs: 730 * 24 * 60 * 60_000,
  /** RN-15 (UTF-16, igual a maxLength). */
  motivoMax: 200,
  /** Teto do texto bruto de data/hora antes da regex. */
  campoMaxCaracteres: 20,
  /** Itens listados no aviso (D-18). */
  avisoMax: 100,
});

export type ModoBloqueio = 'horario' | 'dia_inteiro';
export const MODOS_BLOQUEIO: readonly ModoBloqueio[] = Object.freeze(['horario', 'dia_inteiro'] as ModoBloqueio[]);
export const ALVO_SALAO = 'salao';

export type CampoBloqueio =
  | 'alvo'
  | 'modo'
  | 'dataInicio'
  | 'horaInicio'
  | 'dataFim'
  | 'horaFim'
  | 'motivo'
  | 'periodo'
  | 'formulario';
export type ErrosBloqueio = Partial<Record<CampoBloqueio, string>>;

/** Textos crus do formulário (o que a casca lê e o que volta para o formulário). */
export type ValoresBloqueio = {
  alvo: string;
  modo: string;
  dataInicio: string;
  horaInicio: string;
  dataFim: string;
  horaFim: string;
  motivo: string;
};

export type EntradaPeriodoBloqueio = {
  modo: unknown;
  dataInicio: unknown;
  horaInicio?: unknown;
  dataFim: unknown;
  horaFim?: unknown;
  motivo?: unknown;
};
/** alvo: 'salao' | id do profissional. Para o papel profissional, opcional (alvo = próprio perfil). */
export type EntradaCriarBloqueio = EntradaPeriodoBloqueio & { alvo?: unknown };
/** Sem alvo: nível e dono são imutáveis (RN-11). Chave extra (alvo, profissionalId, salaoId) → 'formulario'. */
export type EntradaEditarBloqueio = EntradaPeriodoBloqueio & { id: unknown };
export type EntradaRemoverBloqueio = { id: unknown };

export type AlvoBloqueio = { tipo: 'salao' } | { tipo: 'profissional'; id: string; nome: string; ativo: boolean };

/** Item da lista (RN-18) e cabeçalho da edição. */
export type BloqueioItem = {
  id: string;
  alvo: AlvoBloqueio;
  /** ISO UTC (serializável para o cliente). */
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  /** formatarPeriodoBloqueio no fuso do salão. */
  periodo: string;
  motivo: string | null;
  /** Gestor: sempre; profissional: só os próprios (D-10). */
  editavel: boolean;
};

export type ReservaCoberta = {
  /** Id da reserva. */
  id: string;
  /** Id do item (D-050 RN-38: uma linha por item; chave única da lista). */
  itemId: string;
  profissionalNome: string;
  /** formatarDataHora no fuso do salão. */
  inicioLocal: string;
  fimLocal: string;
  /** Nome ou "cliente removida". */
  cliente: string;
};
/** `total` pode exceder o número de itens listados (avisoMax). */
export type AvisoReservas = { reservas: ReservaCoberta[]; total: number };

export type ResultadoSalvarBloqueio =
  | { resultado: 'salvo'; bloqueio: BloqueioItem; aviso: AvisoReservas }
  | { resultado: 'invalido'; erros: ErrosBloqueio };
export type ResultadoRemoverBloqueio = { resultado: 'removido'; id: string };

/** 'salao' → 'Salão inteiro'; inativo → 'Bia (inativo)'. */
export type OpcaoAlvo = { valor: string; rotulo: string };

export const MENSAGENS_BLOQUEIO = Object.freeze({
  alvo: 'Escolha o salão inteiro ou um profissional.',
  modo: 'Escolha "Com horário" ou "Dia inteiro".',
  data: 'Informe a data no formato dd/mm/aaaa (ex.: 25/12/2026).',
  dataInexistente: 'Esta data não existe no calendário.',
  hora: 'Informe a hora no formato HH:MM, de 00:00 a 23:55 (ex.: 14:00).',
  granularidade: 'Use minutos múltiplos de 5 (ex.: 14:05).',
  ordem: 'O fim precisa ser depois do início.',
  ordemDias: 'A data final não pode ser anterior à inicial.',
  passado: 'O bloqueio precisa terminar depois de agora.',
  duracao: 'O bloqueio pode durar no máximo 366 dias.',
  antecedencia: 'O início pode estar no máximo 2 anos à frente.',
  motivo: 'Use no máximo 200 caracteres no motivo.',
  formulario: 'Não foi possível ler os dados enviados. Recarregue a página e tente de novo.',
  resumoErros: 'Corrija os campos indicados para salvar o bloqueio.',
  ajudaPeriodo:
    'Horário local do salão. Com horário: datas dd/mm/aaaa e horas HH:MM em múltiplos de 5 minutos; pode passar da meia-noite. Dia inteiro: da data de início até o fim da data de fim; as horas são ignoradas.',
  salvo: 'Bloqueio salvo.',
  removido: 'Bloqueio removido.',
  semReservas: 'Nenhuma reserva confirmada fica sob este bloqueio.',
  comReservas:
    'Atenção: estas reservas confirmadas ficam sob o bloqueio. Elas não foram alteradas nem canceladas, e as clientes não foram avisadas.',
  maisReservas: (n: number) => `E mais ${n} reserva(s) não listada(s).`,
  salaoInteiro: 'Salão inteiro',
  inativo: '(inativo)',
  somenteLeitura: 'Bloqueio do salão: só o gestor altera.',
  vazio: 'Nenhum bloqueio vigente ou futuro.',
  naoEncontrado: 'Bloqueio não encontrado. Ele pode já ter sido removido.',
  acessoNegado: 'Acesso negado.',
  /** Texto do formulário do profissional (sem escolha de alvo). */
  propriaAgenda: 'O bloqueio vale para a sua agenda.',
});
