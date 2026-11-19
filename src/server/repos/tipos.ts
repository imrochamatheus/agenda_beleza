import type {
  OrigemReserva as OrigemReservaPrisma,
  PapelUsuario as PapelUsuarioPrisma,
  StatusReserva as StatusReservaPrisma,
} from '@/generated/prisma/enums';
import type { Papel } from '@/server/tenant/context';

/**
 * DTOs dos repositórios de tenant e uniões literais usáveis fora de repos/** (S-6a: fora daqui só
 * `import type` do Prisma é permitido). Os DTOs não expõem salaoId: o chamador já o conhece pelo
 * contexto (D-005 §3.4, item 5).
 */
export type StatusReserva = 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
export type OrigemReserva = 'publico' | 'equipe';

// Asserções de tipo: as uniões são exatamente os enums do Prisma (o typecheck falha se divergirem).
type Igual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Verdadeiro<T extends true> = T;
export type StatusReservaEquivaleAoEnum = Verdadeiro<Igual<StatusReserva, StatusReservaPrisma>>;
export type OrigemReservaEquivaleAoEnum = Verdadeiro<Igual<OrigemReserva, OrigemReservaPrisma>>;
/** `Papel` (tenant/context.ts) fica sem importar o Prisma; a equivalência é conferida aqui. */
export type PapelEquivaleAoEnum = Verdadeiro<Igual<Papel, PapelUsuarioPrisma>>;

export type ServicoDTO = {
  id: string;
  nome: string;
  precoCentavos: number;
  duracaoMin: number;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
};

export type ProfissionalDTO = {
  id: string;
  nome: string;
  email: string | null;
  usuarioId: string | null;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
};

/** Anonimizada: nome e telefone nulos e anonimizadaEm preenchido (a UI mostra "cliente removida"). */
export type ClienteDTO = {
  id: string;
  nome: string | null;
  telefoneE164: string | null;
  anonimizadaEm: Date | null;
  criadoEm: Date;
  atualizadoEm: Date;
};

export type ReservaItemDTO = {
  servicoId: string;
  ordem: number;
  precoCentavos: number;
  duracaoMin: number;
};

export type ReservaDTO = {
  id: string;
  profissionalId: string;
  clienteId: string;
  inicio: Date;
  fim: Date;
  ocupadoAte: Date;
  status: StatusReserva;
  origem: OrigemReserva;
  encaixe: boolean;
  revisao: number;
  itens: ReservaItemDTO[];
};

/** Período semiaberto [de, ate) sobre `reserva.inicio`. */
export type Periodo = { de: Date; ate: Date };
