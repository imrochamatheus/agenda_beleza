import type { DataCivil } from '@/server/tempo/fuso';

// Contratos da agenda da equipe (D-028 §3). Client-safe: só tipos, constantes e textos, sem imports de
// servidor de runtime. O DTO da grade NUNCA tem telefone (CA-17); o contato só existe no detalhe.

export const VISOES = ['dia', 'semana'] as const;
export type Visao = (typeof VISOES)[number];

export const LIMITES_AGENDA = Object.freeze({
  /** Reservas exibidas por período (a leitura busca uma a mais para saber se truncou). */
  reservas: 200,
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
  truncada: 'Mostrando as primeiras 200 reservas do período. Filtre por profissional ou use a visão por dia para ver as demais.',
  inativo: 'inativo',
  encaixe: 'Encaixe',
  bloqueio: 'Bloqueio',
  bloqueioDoSalao: 'Bloqueio do salão',
});

export type StatusAgenda = 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
export type OrigemAgenda = 'publico' | 'equipe';

export type ItemDaAgenda = { nome: string; precoCentavos: number; duracaoMin: number };

/** Reserva na grade: sem telefone. `clienteNome` null = anonimizada (a tela mostra "cliente removida"). */
export type ReservaDaAgenda = {
  id: string;
  profissionalId: string;
  inicio: Date;
  fim: Date;
  status: StatusAgenda;
  origem: OrigemAgenda;
  encaixe: boolean;
  clienteNome: string | null;
  itens: ItemDaAgenda[];
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
  reservas: ReservaDaAgenda[];
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

export type DetalheDaReserva = {
  id: string;
  fuso: string;
  profissional: { id: string; nome: string; ativo: boolean };
  clienteNome: string | null;
  anonimizada: boolean;
  /** Só para quem tem `cliente.contato`; null para anonimizada ou se a leitura falhar. */
  contato: ContatoDaReserva | null;
  inicio: Date;
  fim: Date;
  status: StatusAgenda;
  origem: OrigemAgenda;
  encaixe: boolean;
  itens: ItemDaAgenda[];
  totalCentavos: number;
  duracaoTotalMin: number;
};
