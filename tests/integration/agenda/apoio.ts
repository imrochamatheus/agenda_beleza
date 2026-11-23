import type pg from 'pg';

import { criarTenantContext } from '@/server/tenant/context';
import type { TenantContext } from '@/server/tenant/context';

import { criarCenarioReserva } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { inserirReservaComItens, telefoneNovo } from '../../support/sql';

export { ctxDoGestor, ctxDoProfissional } from '../profissionais/apoio';
export { UUID_INEXISTENTE } from '../salao/apoio';
export { anonimizarPorSql, inserirCliente, inserirReservaComPreco } from '../clientes/apoio';

// Apoio local aos testes de tests/integration/agenda (D-028). Não é arquivo de teste. Relógio injetado:
// AGORA = 01/12/2026 12:00 em São Paulo (terça). SQL direto pelo driver `pg`, sem mocks de banco.

export const AGORA = new Date('2026-12-01T15:00:00Z');
export const SP = 'America/Sao_Paulo';

/** Cenário limpo (Ana com jornada 09–19 todos os dias, Bia sem jornada; gestor sem perfil). */
export const criarCenario = (o: Parameters<typeof criarCenarioReserva>[0] = {}): Promise<CenarioReserva> => criarCenarioReserva(o);

/** Contexto do profissional de papel `profissional` (Ana). */
export function ctxDaAna(c: CenarioReserva): TenantContext {
  return criarTenantContext({
    usuarioId: c.s.profissional.usuarioId,
    papel: 'profissional',
    salaoId: c.s.salaoId,
    profissionalId: c.ana,
  });
}

export type StatusSql = 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';

export type ItemNovo = {
  servicoId: string;
  precoCentavos: number;
  duracaoMin: number;
  /** D-050: padrão = o da reserva. */
  profissionalId?: string;
  /** D-050: padrão = encadeado depois do item anterior (o 1º em `inicio`). */
  inicio?: Date;
  /** D-050: padrão = o da reserva. */
  status?: StatusSql;
  /** D-050: padrão = o da reserva. */
  encaixe?: boolean;
};

export type NovaReserva = {
  /** Profissional padrão dos itens. */
  profissionalId: string;
  inicio: Date;
  /** Só com o item padrão: a duração dele passa a ser `fim - inicio`. */
  fim?: Date;
  /** Status padrão dos itens (os derivados da reserva saem dos itens). */
  status?: StatusSql;
  clienteId?: string;
  encaixe?: boolean;
  revisao?: number;
  itens?: ItemNovo[];
};

/**
 * D-050: reserva com itens de snapshot gravada por SQL direto (`inserirReservaComItens`: derivados pela
 * regra de `derivarReserva`, um único comando). Padrão: um item do serviço A, R$ 50,00, 60 min (ou
 * `fim - inicio`). Itens sem `inicio` são encadeados. Devolve os ids da reserva e dos itens (ordem do array).
 */
export async function reservarComItens(c: pg.Client, ce: CenarioReserva, r: NovaReserva): Promise<{ reservaId: string; itemIds: string[] }> {
  if (r.fim !== undefined && r.itens !== undefined) throw new RangeError('reservar: `fim` só com o item padrão');
  const minutos = r.fim === undefined ? 60 : (r.fim.getTime() - r.inicio.getTime()) / 60_000;
  const itens = r.itens ?? [{ servicoId: ce.A, precoCentavos: 5000, duracaoMin: minutos }];
  let clienteId = r.clienteId;
  if (clienteId === undefined) {
    const { rows } = await c.query<{ id: string }>(
      'INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, $2, $3) RETURNING id::text AS id',
      [ce.s.salaoId, 'Cliente da Agenda', telefoneNovo()],
    );
    clienteId = rows[0].id;
  }
  let t = r.inicio.getTime();
  return inserirReservaComItens(c, {
    salaoId: ce.s.salaoId,
    clienteId,
    origem: 'equipe',
    revisao: r.revisao,
    itens: itens.map((i) => {
      const inicio = i.inicio ?? new Date(t);
      t = inicio.getTime() + i.duracaoMin * 60_000;
      return {
        profissionalId: i.profissionalId ?? r.profissionalId,
        inicio,
        duracaoMin: i.duracaoMin,
        status: i.status ?? r.status ?? 'confirmado',
        encaixe: i.encaixe ?? r.encaixe ?? false,
        servicoId: i.servicoId,
        precoCentavos: i.precoCentavos,
      };
    }),
  });
}

/** Como `reservarComItens`, devolvendo só o id da reserva. */
export async function reservar(c: pg.Client, ce: CenarioReserva, r: NovaReserva): Promise<string> {
  return (await reservarComItens(c, ce, r)).reservaId;
}

export async function bloquear(
  c: pg.Client,
  salaoId: string,
  b: { profissionalId: string | null; inicio: Date; fim: Date; motivo?: string | null },
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    'INSERT INTO bloqueio (salao_id, profissional_id, inicio, fim, motivo) VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id',
    [salaoId, b.profissionalId, b.inicio, b.fim, b.motivo ?? null],
  );
  return rows[0].id;
}

/** Hora local de São Paulo em 2026 (UTC−3 fixo) no dia 01/12 + `dias`. */
export const hora = (hhmm: string, dias = 0): Date => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 11, 1 + dias, h + 3, m));
};
