// Contratos das operações POR ITEM da equipe (D-030; D-050 §3.6, T-6): remarcar item, cancelar item, marcar
// status do item e cancelar todos. Client-safe: só tipos e constantes.
import type { ResultadoRegistro } from '@/server/mensagens/tipos';
import type { StatusReserva } from '@/server/repos/tipos';
import type { PoliticaOperacao } from '@/server/tenant/politica';

import type { MotivoRecusaDeStatus } from './status';
import type { DependenciasCriarReserva, MotivoEncaixe } from './tipos';

/** Estado da mensagem registrada na mesma transação (o envio é assíncrono). */
export type MensagemRegistrada = { mensagemId: string; estado: ResultadoRegistro['estado'] };

export type MotivoRecusaDeRemarcacao = 'item_final' | 'transicao_invalida' | 'sem_alteracao' | 'data_diferente' | 'servico_repetido';

/** `profissional`: item de profissional inativo enviado sem escolher outro (D-050 DEF-1). */
export type ErrosRemarcacao = Partial<Record<'servico' | 'inicio' | 'data' | 'profissional', string>>;

export type ResultadoRemarcarItem =
  | { resultado: 'atualizada'; itemId: string; revisao: number; encaixe: boolean; mensagem: MensagemRegistrada }
  | { resultado: 'invalido'; erros: ErrosRemarcacao }
  /** `entre_itens`: o novo horário cruza outro serviço da mesma reserva (RN-8/RN-9); `23P01`: outra reserva. */
  | { resultado: 'horario_indisponivel'; causa: '23P01' | 'entre_itens' }
  | { resultado: 'servico_indisponivel' }
  | { resultado: 'profissional_indisponivel' }
  | { resultado: 'encaixe_requer_confirmacao'; motivos: MotivoEncaixe[] }
  | { resultado: 'recusado'; motivo: MotivoRecusaDeRemarcacao };

export type ResultadoStatusItem =
  | {
      resultado: 'atualizada';
      itemId: string;
      /** Status novo do item. */
      status: StatusReserva;
      /** Status DERIVADO da reserva depois da operação (RN-21). */
      statusReserva: StatusReserva;
      /** `reserva.revisao` depois da operação (cancelar sobe 1; marcar status não muda). */
      revisao: number;
      /** Mensagens registradas na transação (cancelamento do item e/ou convite de avaliação). */
      mensagens: MensagemRegistrada[];
    }
  | { resultado: 'recusado'; motivo: MotivoRecusaDeStatus };

export type ResultadoCancelarTodos =
  | {
      resultado: 'atualizada';
      /** Itens cancelados, por (inicio, id). */
      itemIds: string[];
      revisao: number;
      statusReserva: StatusReserva;
      mensagens: MensagemRegistrada[];
    }
  | { resultado: 'recusado'; motivo: 'nenhum_cancelavel' };

export type EntradaRemarcarItem = {
  reservaId: unknown;
  itemId: unknown;
  /** Serviço do item depois da remarcação; ausente ou vazio = o atual (novo snapshot só se mudar). */
  servicoId?: unknown;
  /** Profissional do item depois da remarcação; ausente ou vazio = o atual. */
  profissionalId?: unknown;
  /**
   * AAAA-MM-DD no fuso do salão; ausente ou vazio = a data atual do item. Outra data só se o item for o único
   * não cancelado da reserva (RN-22).
   */
  data?: unknown;
  /** HH:MM no fuso do salão. */
  hora: unknown;
  /** Só `true`/'on' confirma o encaixe. */
  confirmarEncaixe?: unknown;
};

export type EntradaItem = { reservaId: unknown; itemId: unknown };
export type EntradaMarcarStatusItem = EntradaItem & { destino: unknown };
export type EntradaCancelarTodos = { reservaId: unknown };

export type DependenciasAlteracao = Pick<DependenciasCriarReserva, 'enfileirar'> & {
  /** Política (D-038): padrão `politicaDeOperacao`. Negar lança 403 antes de abrir a transação. */
  politica?: PoliticaOperacao;
  /** SÓ TESTE: barreira depois das travas de salão/profissionais/serviços e antes de travar a cliente e a reserva. */
  aposTravas?: () => Promise<void>;
};

/** Textos pt-BR das recusas e dos erros (web-design §5.10). */
export const MENSAGENS_ALTERACAO = Object.freeze({
  inicio: 'Informe uma data e uma hora válidas (HH:MM).',
  inicioPassado: 'O novo horário não pode estar no passado.',
  servico: 'Escolha um serviço válido.',
  /** D-050 DEF-1: o profissional atual do item está inativo e nenhum outro foi escolhido. */
  escolhaProfissional: 'Escolha a profissional.',
  transicao_invalida: 'Esta ação não é possível para a situação atual do serviço.',
  ainda_nao_iniciada: 'Só é possível marcar o resultado depois do início do serviço.',
  ja_terminada: 'Este serviço já terminou e não pode mais ser cancelado.',
  item_final: 'Este serviço está cancelado.',
  sem_alteracao: 'Nenhuma alteração: informe outro horário, profissional ou serviço.',
  data_diferente: 'Os outros serviços desta reserva estão em outra data; a data não pode mudar.',
  servico_repetido: 'Este serviço já faz parte desta reserva.',
  entre_itens: 'O novo horário coincide com outro serviço desta reserva.',
  nenhum_cancelavel: 'Nenhum serviço desta reserva pode ser cancelado agora.',
  acessoNegado: 'Acesso negado.',
  naoEncontrado: 'Reserva não encontrada.',
  generico: 'Não foi possível concluir a ação. Tente de novo.',
} satisfies Record<string, string>);
