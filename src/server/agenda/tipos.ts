import type { DataCivil } from '@/server/tempo/fuso';

// Contratos da agenda da equipe (D-028 §3). Client-safe: só tipos, constantes e textos, sem imports de
// servidor de runtime. O DTO da grade NUNCA tem telefone (CA-17); o contato só existe no detalhe.

export const VISOES = ['dia', 'semana'] as const;
export type Visao = (typeof VISOES)[number];

export const LIMITES_AGENDA = Object.freeze({
  /** D-050 RN-36: ITENS (blocos) exibidos por período (a leitura busca um a mais para saber se truncou). */
  itens: 200,
  /** Datas aceitas: hoje ± 5 anos (fora disso cai no padrão, sem erro). */
  anos: 5,
});

export const MENSAGENS_AGENDA = Object.freeze({
  titulo: 'Agenda',
  foraDoFuncionamento: 'Fora do funcionamento',
  foraDaJornada: 'Fora da jornada',
  salaoFechado: 'Salão fechado',
  semReservas: 'Sem reservas nem bloqueios neste dia.',
  semColunas: 'Nenhum profissional com agenda neste período.',
  /** D-050 web-design §5.9 (limite por itens). */
  truncada: 'Mostrando os primeiros 200 serviços deste período. Use o filtro de profissional ou a visão por dia para ver o restante.',
  inativo: 'inativo',
  encaixe: 'Encaixe',
  novaReserva: 'Nova reserva',
  bloqueio: 'Bloqueio',
  bloqueioDoSalao: 'Bloqueio do salão',
  /** D-050 web-design §5.10 / ND-2: exibida SEMPRE para o papel profissional no detalhe. */
  apenasSeusServicos: 'Você vê apenas os seus serviços nesta reserva.',
  /** D-050 RN-35: só quando há item cancelado e a reserva não está toda cancelada. */
  canceladosForaDoTotal: 'Itens cancelados não entram no total.',
});

export type StatusAgenda = 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
export type OrigemAgenda = 'publico' | 'equipe';

/**
 * D-050 §3.9 (RN-36): um bloco por ITEM na coluna do profissional do item. Sem telefone (CA-17);
 * `clienteNome` null = anonimizada. Todos os blocos da mesma reserva levam ao mesmo detalhe (`reservaId`).
 */
export type BlocoDaAgenda = {
  itemId: string;
  reservaId: string;
  profissionalId: string;
  /** Do item. */
  inicio: Date;
  fim: Date;
  /** Do item. */
  status: StatusAgenda;
  origem: OrigemAgenda;
  /** Do item. */
  encaixe: boolean;
  clienteNome: string | null;
  servicoNome: string;
  /** Snapshot do item. */
  precoCentavos: number;
  duracaoMin: number;
  /** Há mensagem de WhatsApp `falhou` vigente NA RESERVA (D-043; RN-37: vale para todos os blocos dela). */
  temFalhaDeMensagem: boolean;
  /**
   * "n de N" entre os itens NÃO cancelados da reserva, por (inicio, id). Só para o gestor e só quando a
   * reserva tem 2+ itens não cancelados e este item não está cancelado; null nos demais casos (sempre null
   * para o profissional, CA-33/C4).
   */
  posicao: { n: number; de: number } | null;
};

export type BloqueioDaAgenda = { id: string; profissionalId: string | null; inicio: Date; fim: Date; motivo: string | null };

/** Intervalo [inicioMin, fimMin) em minutos de parede do dia local, 0..1440. */
export type FaixaDoDia = { inicioMin: number; fimMin: number };

export type DiaDaAgenda = {
  /** AAAA-MM-DD */
  iso: string;
  data: DataCivil;
  /** 0 = domingo. */
  diaSemana: number;
  /** [00:00 local, 00:00 local seguinte) em UTC. */
  inicio: Date;
  fim: Date;
  /** Fechado pelo funcionamento do salão (vazio com `definido: false`). */
  foraDoFuncionamento: FaixaDoDia[];
  /** Dia inteiro fechado. */
  salaoFechado: boolean;
};

export type ColunaDaAgenda = {
  id: string;
  nome: string;
  ativo: boolean;
  /** D-050: blocos (itens) do profissional da coluna, por (inicio, itemId). */
  blocos: BlocoDaAgenda[];
  /** Próprios e do salão inteiro (replicados em cada coluna). */
  bloqueios: BloqueioDaAgenda[];
  /** Por `DiaDaAgenda.iso`: fora da jornada (sem o que já é "fora do funcionamento"). */
  foraDaJornada: Record<string, FaixaDoDia[]>;
};

export type OpcaoDeProfissional = { id: string; nome: string; ativo: boolean };

export type AgendaVista = {
  visao: Visao;
  /** Data de referência AAAA-MM-DD. */
  data: string;
  fuso: string;
  dias: DiaDaAgenda[];
  colunas: ColunaDaAgenda[];
  /** Opções do filtro (só o gestor; vazio para o profissional). */
  profissionais: OpcaoDeProfissional[];
  profissionalFiltro: string | null;
  truncada: boolean;
  /** Datas dos links "anterior", "próximo" e "hoje" (AAAA-MM-DD). */
  anterior: string;
  proximo: string;
  hoje: string;
};

export type ContatoDaReserva = { telefoneE164: string };

/** Ações que a máquina de status (D-030, por item) aceitaria agora. Mesma forma de `AcoesPermitidas`. */
export type AcoesDoItem = { remarcar: boolean; cancelar: boolean; concluir: boolean; naoCompareceu: boolean };

/** Item do detalhe (D-050 §3.9). O profissional recebe só os itens dele (CA-33); os demais nem chegam. */
export type ItemDoDetalhe = {
  id: string;
  servicoId: string;
  servicoNome: string;
  profissionalId: string;
  profissionalNome: string;
  profissionalAtivo: boolean;
  inicio: Date;
  fim: Date;
  status: StatusAgenda;
  encaixe: boolean;
  /** Snapshot. */
  precoCentavos: number;
  duracaoMin: number;
  acoes: AcoesDoItem;
};

/**
 * RN-35: `reserva` (gestor) e `seus_servicos` (profissional) somam os itens visíveis NÃO cancelados;
 * `cancelada` (status derivado `cancelado`) soma todos os itens visíveis. `servicos` = itens somados.
 */
export type TotalDoDetalhe = { centavos: number; servicos: number; rotulo: 'reserva' | 'seus_servicos' | 'cancelada' };

export type DetalheDaReserva = {
  id: string;
  clienteId: string;
  fuso: string;
  clienteNome: string | null;
  anonimizada: boolean;
  /** Só para quem tem `cliente.contato`; null para anonimizada ou se a leitura falhar. */
  contato: ContatoDaReserva | null;
  /** Data local (fuso do salão) do agendamento; todos os itens estão nela (RN-3). Substitui Início/Fim. */
  data: DataCivil;
  /** Status DERIVADO da reserva (RN-21). */
  status: StatusAgenda;
  origem: OrigemAgenda;
  temFalhaDeMensagem: boolean;
  /** Por (inicio, id). */
  itens: ItemDoDetalhe[];
  total: TotalDoDetalhe;
  /** Algum item VISÍVEL está cancelado. */
  temItemCancelado: boolean;
  /** Gestor e 2+ itens visíveis canceláveis agora (RN-24; ND-3). Sempre false para o profissional. */
  podeCancelarTodos: boolean;
  papel: 'gestor' | 'profissional';
};
