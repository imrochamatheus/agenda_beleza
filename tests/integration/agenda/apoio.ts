import type pg from 'pg';

import { criarTenantContext } from '@/server/tenant/context';
import type { TenantContext } from '@/server/tenant/context';

import { criarCenarioReserva } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { telefoneNovo } from '../../support/sql';

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

export type NovaReserva = {
  profissionalId: string;
  inicio: Date;
  fim?: Date;
  status?: 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
  clienteId?: string;
  encaixe?: boolean;
  itens?: { servicoId: string; precoCentavos: number; duracaoMin: number }[];
};

/** Reserva com itens de snapshot (padrão: serviço A, R$ 50,00, 60 min). Devolve o id. */
export async function reservar(c: pg.Client, ce: CenarioReserva, r: NovaReserva): Promise<string> {
  const itens = r.itens ?? [{ servicoId: ce.A, precoCentavos: 5000, duracaoMin: 60 }];
  const minutos = itens.reduce((t, i) => t + i.duracaoMin, 0);
  const fim = r.fim ?? new Date(r.inicio.getTime() + minutos * 60_000);
  let clienteId = r.clienteId;
  if (clienteId === undefined) {
    const { rows } = await c.query<{ id: string }>(
      'INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, $2, $3) RETURNING id::text AS id',
      [ce.s.salaoId, 'Cliente da Agenda', telefoneNovo()],
    );
    clienteId = rows[0].id;
  }
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem, encaixe)
     VALUES ($1, $2, $3, $4, $5, $5, $6, 'equipe', $7) RETURNING id::text AS id`,
    [ce.s.salaoId, r.profissionalId, clienteId, r.inicio, fim, r.status ?? 'confirmado', r.encaixe ?? false],
  );
  for (const [ordem, i] of itens.entries()) {
    await c.query(
      `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, ordem, preco_centavos, duracao_min)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ce.s.salaoId, rows[0].id, i.servicoId, ordem, i.precoCentavos, i.duracaoMin],
    );
  }
  return rows[0].id;
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
