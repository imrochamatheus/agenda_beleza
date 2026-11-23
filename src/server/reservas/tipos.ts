// Contratos da criação de reserva (D-025 §3.2; D-050 §3.5: N itens com profissional e horário próprios). Client-safe: só tipos e constantes, sem imports de
// runtime de servidor.
import type { ErrosConsentimento } from '@/server/consentimento/tipos';
import type { DependenciasEnfileirar } from '@/server/mensagens/enfileirar';
import type { Repos } from '@/server/repos';
import type { StatusReserva } from '@/server/repos/tipos';
import type { ContextoEscopado } from '@/server/tenant/context';
import type { DecisaoPolitica } from '@/server/tenant/politica';

export type ModoReserva = 'normal' | 'encaixe';

/** D-029 RN-2: por que um horário da equipe sai da disponibilidade normal (todos podem coexistir). */
export type MotivoEncaixe = 'fora_da_jornada' | 'bloqueado' | 'fora_do_funcionamento';
export const MOTIVOS_ENCAIXE: readonly MotivoEncaixe[] = Object.freeze(['fora_da_jornada', 'bloqueado', 'fora_do_funcionamento']);

export const MENSAGENS_MOTIVO_ENCAIXE: Readonly<Record<MotivoEncaixe, string>> = Object.freeze({
  fora_da_jornada: 'Fora da jornada do profissional.',
  bloqueado: 'Horário bloqueado.',
  fora_do_funcionamento: 'Fora do funcionamento do salão.',
});

/**
 * Decisão do encaixe da equipe em LOTE (D-050 §3.5, A-11, RN-17): `encaixes[k]` é o flag gravado no item k
 * (true só quando o item tinha motivo e a equipe confirmou); `motivos` lista os itens com motivo quando não
 * houve confirmação (nada é gravado).
 */
export type DecisaoEncaixe = { encaixes: boolean[] } | { motivos: MotivosDoItem[] };
/** Motivos de encaixe de um item (índice do item pedido). */
export type MotivosDoItem = { indice: number; motivos: MotivoEncaixe[] };

/** Um item pedido (D-050 §3.5): serviço, profissional e início próprios. */
export type ItemPedido = { servicoId: string; profissionalId: string; inicio: Date };

export type EntradaCriarReserva = {
  /** 1..10, `servicoId` sem repetição; a posição é a `ordem` gravada. Todos na mesma data local (RN-3). */
  itens: readonly ItemPedido[];
  cliente: { nome: unknown; telefone: unknown };
  aceites: unknown;
  /** UUID gerado ao renderizar o formulário público; nulo para a equipe. */
  chaveRequisicao?: string | null;
  /** Padrão `normal`; `encaixe` só com contexto de equipe. */
  modo?: ModoReserva;
  /** Relógio injetado, obrigatório. */
  agora: Date;
};

export type CausaIndisponibilidade = '23P01' | 'revalidacao' | 'entre_itens';
export type CampoInvalidoReserva = 'itens' | 'nome' | 'telefone' | 'chave';
export type CampoDoItem = 'servico' | 'profissional' | 'inicio';
export type ErrosReserva = Partial<Record<CampoInvalidoReserva, string>> & {
  /** Por índice do item pedido. */
  porItem?: Record<number, Partial<Record<CampoDoItem, string>>>;
};

export type ItemDeReservaCriada = {
  id: string;
  servicoId: string;
  profissionalId: string;
  /** Posição na escolha (0, 1, …). */
  ordem: number;
  inicio: Date;
  fim: Date;
  ocupadoAte: Date;
  precoCentavos: number;
  duracaoMin: number;
  encaixe: boolean;
  status: StatusReserva;
};

export type ReservaCriada = {
  id: string;
  clienteId: string;
  /** Envelope dos itens não cancelados (A-2). */
  inicio: Date;
  fim: Date;
  status: StatusReserva;
  origem: 'publico' | 'equipe';
  revisao: number;
  /** Por (inicio, id). */
  itens: ItemDeReservaCriada[];
};

export type ResultadoCriarReserva =
  | {
      resultado: 'criada';
      reserva: ReservaCriada;
      confirmacao: { mensagemId: string; estado: 'pendente' | 'nao_enviada' };
    }
  | { resultado: 'repetida'; reserva: ReservaCriada }
  | {
      resultado: 'horario_indisponivel';
      causa: CausaIndisponibilidade;
      /** Índices dos itens que falharam (vazio quando o 23P01 não identifica o item). */
      itens: readonly number[];
      /** Só em `entre_itens`: índice do item com que cada um conflita. */
      conflitos?: Readonly<Record<number, number>>;
    }
  | { resultado: 'servico_indisponivel' }
  | { resultado: 'profissional_indisponivel'; itens: readonly number[] }
  | { resultado: 'invalido'; erros: ErrosReserva }
  | { resultado: 'consentimento_ausente'; erros: ErrosConsentimento }
  | { resultado: 'chave_reutilizada' }
  | { resultado: 'recusado'; motivo: string }
  | { resultado: 'salao_indisponivel' }
  | { resultado: 'encaixe_requer_confirmacao'; motivos: MotivosDoItem[] };

/**
 * Política de estado do salão para reservar (A-9). D-038: o padrão é `politicaDeOperacao`, para equipe e para o fluxo público (`SistemaContext`).
 */
export type PoliticaDeReserva = (
  ctx: ContextoEscopado,
  capacidade: 'agendar',
  agora: Date,
) => DecisaoPolitica | Promise<DecisaoPolitica>;

export type DependenciasCriarReserva = {
  enfileirar?: DependenciasEnfileirar['enfileirar'];
  /** E4.2: chamada na transação entre o upsert da cliente e o INSERT da reserva (RN-16); `inicio` = envelope. */
  antesDaReserva?: (
    ctx: ContextoEscopado,
    r: Repos,
    d: { clienteId: string; inicio: Date },
  ) => Promise<{ permitido: true } | { permitido: false; motivo: string }>;
  politica?: PoliticaDeReserva;
  /**
   * E3.4/D-050 (só com `modo: 'encaixe'`): chamada na transação depois das travas e da checagem entre
   * itens, antes do upsert da cliente, com TODOS os itens (lote, A-11; `decisor-encaixe.ts`). Substitui a
   * revalidação de disponibilidade e decide o flag `encaixe` de cada item; `motivos` desfaz tudo e devolve
   * `encaixe_requer_confirmacao`. Sem ela, o modo encaixe grava `encaixe = true` em todos os itens.
   */
  decidirEncaixe?: (
    ctx: ContextoEscopado,
    r: Repos,
    d: { fuso: string; itens: { inicio: Date; fim: Date; profissionalId: string }[] },
  ) => Promise<DecisaoEncaixe>;
  /**
   * E3.4 (só equipe): o aceite de `mensagens_reserva` deixa de ser obrigatório; sem ele a cliente é
   * criada sem consentimento e a confirmação nasce `nao_enviada` (D-029 CA-5).
   */
  consentimentoOpcional?: boolean;
  /** SÓ TESTE (A-6): barreira depois da revalidação e antes do upsert. Nada em produção a define. */
  aposRevalidar?: () => Promise<void>;
};

/** Texto pt-BR para "horário indisponível"; nunca revela quem ocupa o horário. */
export const MENSAGEM_HORARIO_INDISPONIVEL =
  'Este horário não está mais disponível. Escolha outro horário.';

export const MENSAGENS_RESERVA = {
  servicos: 'Escolha de um a dez serviços, sem repetir.',
  inicio: 'Informe um horário válido, em minutos cheios.',
  /** D-050 RN-3: todos os itens na mesma data local do salão. */
  dataDiferente: 'Todos os serviços precisam ser no mesmo dia.',
  inicioPassado: 'O horário não pode estar no passado.',
  chave: 'Chave da requisição inválida.',
} as const;

/**
 * D-029/D-050 §3.11: entrada bruta da reserva manual (campos do formulário; tudo é validado no servidor).
 * Uma data local e N itens com serviço, profissional e hora (HH:MM) próprios.
 */
export type EntradaReservaEquipe = {
  /** AAAA-MM-DD, no fuso do salão. */
  data: unknown;
  itens: { servicoId: unknown; profissionalId: unknown; /** HH:MM, no fuso do salão. */ hora: unknown }[];
  nome: unknown;
  telefone: unknown;
  aceites: unknown;
  /** Só `true`/'on' confirma (D-029 RN-3; D-050 RN-17: uma confirmação vale para todos os itens). */
  confirmarEncaixe: unknown;
  chaveRequisicao: unknown;
};

export const MENSAGENS_RESERVA_EQUIPE = {
  inicio: 'Informe uma data e uma hora válidas (HH:MM).',
  encaixeAviso: 'Este horário está fora do horário normal de atendimento. Para registrar mesmo assim, confirme o encaixe.',
  confirmarEncaixe: 'Confirmo o encaixe',
} as const;
