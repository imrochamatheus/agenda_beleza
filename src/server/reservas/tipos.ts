// Contratos da criação de reserva (D-025 §3.2). Client-safe: só tipos e constantes, sem imports de
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

/** Decisão do E3.4: `encaixe` é o flag gravado; `motivos` pede a confirmação da equipe (nada é gravado). */
export type DecisaoEncaixe = { encaixe: boolean } | { motivos: MotivoEncaixe[] };

export type EntradaCriarReserva = {
  /** 1..10, sem repetição; a ordem é a ordem dos itens. */
  servicoIds: readonly string[];
  profissionalId: string;
  /** UTC, segundos e milissegundos zero. */
  inicio: Date;
  cliente: { nome: unknown; telefone: unknown };
  aceites: unknown;
  /** UUID gerado ao renderizar o formulário público; nulo para a equipe. */
  chaveRequisicao?: string | null;
  /** Padrão `normal`; `encaixe` só com contexto de equipe. */
  modo?: ModoReserva;
  /** Relógio injetado, obrigatório. */
  agora: Date;
};

export type CausaIndisponibilidade = '23P01' | 'revalidacao';
export type CampoInvalidoReserva = 'servicos' | 'inicio' | 'nome' | 'telefone' | 'chave';
export type ErrosReserva = Partial<Record<CampoInvalidoReserva, string>>;

export type ItemDeReservaCriada = {
  servicoId: string;
  ordem: number;
  precoCentavos: number;
  duracaoMin: number;
  inicio: Date;
  fim: Date;
};

export type ReservaCriada = {
  id: string;
  profissionalId: string;
  clienteId: string;
  inicio: Date;
  fim: Date;
  ocupadoAte: Date;
  status: StatusReserva;
  origem: 'publico' | 'equipe';
  encaixe: boolean;
  revisao: number;
  itens: ItemDeReservaCriada[];
};

export type ResultadoCriarReserva =
  | {
      resultado: 'criada';
      reserva: ReservaCriada;
      confirmacao: { mensagemId: string; estado: 'pendente' | 'nao_enviada' };
    }
  | { resultado: 'repetida'; reserva: ReservaCriada }
  | { resultado: 'horario_indisponivel'; causa: CausaIndisponibilidade }
  | { resultado: 'servico_indisponivel' }
  | { resultado: 'profissional_indisponivel' }
  | { resultado: 'invalido'; erros: ErrosReserva }
  | { resultado: 'consentimento_ausente'; erros: ErrosConsentimento }
  | { resultado: 'chave_reutilizada' }
  | { resultado: 'recusado'; motivo: string }
  | { resultado: 'salao_indisponivel' }
  | { resultado: 'encaixe_requer_confirmacao'; motivos: MotivoEncaixe[] };

/**
 * Política de estado do salão para reservar (A-9). Tipo próprio porque `PoliticaOperacao` só aceita
 * `TenantContext`; o fluxo público usa `SistemaContext`. A E6.4 troca `politicaPadraoDeReserva`.
 */
export type PoliticaDeReserva = (
  ctx: ContextoEscopado,
  capacidade: 'agendar',
) => DecisaoPolitica | Promise<DecisaoPolitica>;

export type DependenciasCriarReserva = {
  enfileirar?: DependenciasEnfileirar['enfileirar'];
  /** E4.2: chamada na transação entre o upsert da cliente e o INSERT da reserva (RN-16). */
  antesDaReserva?: (
    ctx: ContextoEscopado,
    r: Repos,
    d: { clienteId: string; inicio: Date },
  ) => Promise<{ permitido: true } | { permitido: false; motivo: string }>;
  politica?: PoliticaDeReserva;
  /**
   * E3.4 (só com `modo: 'encaixe'`): chamada na transação logo depois das travas e antes do upsert da
   * cliente. Substitui a revalidação de disponibilidade e decide o flag `encaixe` gravado; `motivos`
   * desfaz tudo e devolve `encaixe_requer_confirmacao`. Sem ela, o modo encaixe grava `encaixe = true`.
   */
  decidirEncaixe?: (
    ctx: ContextoEscopado,
    r: Repos,
    d: { inicio: Date; fim: Date; fuso: string; profissionalId: string },
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
  inicioPassado: 'O horário não pode estar no passado.',
  chave: 'Chave da requisição inválida.',
} as const;

/** D-029: entrada bruta da reserva manual (campos do formulário; tudo é validado no servidor). */
export type EntradaReservaEquipe = {
  servicoIds: unknown;
  profissionalId: unknown;
  /** AAAA-MM-DD, no fuso do salão. */
  data: unknown;
  /** HH:MM, no fuso do salão. */
  hora: unknown;
  nome: unknown;
  telefone: unknown;
  aceites: unknown;
  /** Só `true`/'on' confirma (D-029 RN-3). */
  confirmarEncaixe: unknown;
  chaveRequisicao: unknown;
};

export const MENSAGENS_RESERVA_EQUIPE = {
  inicio: 'Informe uma data e uma hora válidas (HH:MM).',
  encaixeAviso: 'Este horário está fora do horário normal de atendimento. Para registrar mesmo assim, confirme o encaixe.',
  confirmarEncaixe: 'Confirmo o encaixe',
} as const;
