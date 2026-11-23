import type pg from 'pg';

import type { Credencial } from '@/server/tenant/sessao';

import { criarSessao } from '../../support/auth';
import type { SalaoCompleto } from '../../support/factories';
import { inserirReserva } from '../../support/sql';

export { ctxDoGestor, ctxDoProfissional } from '../profissionais/apoio';

// Apoio local aos testes de tests/integration/bloqueios (D-016). Não é arquivo de teste (o glob do
// Vitest só pega *.test.ts). SQL direto pelo driver `pg` na base deste worker, sem mocks de banco.
//
// Relógio (R-7): as ações recebem `agora` fixo (AGORA, antes de dezembro/2026) para que os instantes
// fixos de 12/2026 dos CAs continuem futuros em qualquer data real. As credenciais usadas com AGORA
// nascem com expiração distante: a renovação no uso grava `min(AGORA + 7 d, criado_em + 30 d)`, que
// continua válida para AGORA. Não misture a mesma credencial com `agora` real.

export const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
export const AGORA = new Date('2026-12-01T12:00:00Z');
export const SP = 'America/Sao_Paulo';
export const MANAUS = 'America/Manaus';

const EXPIRACAO_DISTANTE = new Date('2099-01-01T00:00:00Z');

export const NAO_ENCONTRADO = { ok: false, erro: 'nao_encontrado', status: 404 } as const;
export const ACESSO_NEGADO = { ok: false, erro: 'acesso_negado', status: 403 } as const;
export const NAO_AUTENTICADO = { ok: false, erro: 'nao_autenticado', status: 401 } as const;

/** Credencial do gestor para uso com AGORA. */
export async function credGestor(s: SalaoCompleto): Promise<Credencial> {
  return (await criarSessao(s.gestor.usuarioId, { expiraEm: EXPIRACAO_DISTANTE })).credencial;
}

/** Credencial do profissional (usuário de papel profissional) para uso com AGORA. */
export async function credProfissional(s: SalaoCompleto): Promise<Credencial> {
  return (await criarSessao(s.profissional.usuarioId, { expiraEm: EXPIRACAO_DISTANTE })).credencial;
}

/** Entrada de teste das ações: campos do período mais quaisquer chaves extras. */
export type EntradaTeste = { modo: unknown; dataInicio: unknown; dataFim: unknown; [chave: string]: unknown };

/** Entrada "com horário" (datas dd/mm/aaaa e horas HH:MM). */
export function comHorario(
  dataInicio: string,
  horaInicio: string,
  dataFim: string,
  horaFim: string,
  extra: Record<string, unknown> = {},
): EntradaTeste {
  return { modo: 'horario', dataInicio, horaInicio, dataFim, horaFim, ...extra };
}

/** Entrada "dia inteiro" (datas inclusivas). */
export function diaInteiro(dataInicio: string, dataFim = dataInicio, extra: Record<string, unknown> = {}): EntradaTeste {
  return { modo: 'dia_inteiro', dataInicio, dataFim, ...extra };
}

export type LinhaBloqueio = {
  id: string;
  profissional_id: string | null;
  inicio: string;
  fim: string;
  motivo: string | null;
};

/** Linhas de `bloqueio` do salão (instantes em ISO UTC), ordenadas por início e id. */
export async function linhasBloqueio(c: pg.Client, salaoId: string): Promise<LinhaBloqueio[]> {
  const { rows } = await c.query<LinhaBloqueio>(
    `SELECT id::text AS id, profissional_id::text AS profissional_id,
            to_char(inicio AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS inicio,
            to_char(fim AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fim, motivo
       FROM bloqueio WHERE salao_id = $1 ORDER BY inicio, id`,
    [salaoId],
  );
  return rows;
}

/** Uma linha de `bloqueio` por id (ou undefined). */
export async function linhaBloqueio(c: pg.Client, id: string): Promise<LinhaBloqueio | undefined> {
  const { rows } = await c.query<LinhaBloqueio>(
    `SELECT id::text AS id, profissional_id::text AS profissional_id,
            to_char(inicio AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS inicio,
            to_char(fim AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fim, motivo
       FROM bloqueio WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/** Bloqueio inserido por SQL (cenários de lista, de passado e de outro salão). Devolve o id. */
export async function inserirBloqueio(
  c: pg.Client,
  d: { salaoId: string; profissionalId: string | null; inicio: string | Date; fim: string | Date; motivo?: string | null },
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO bloqueio (salao_id, profissional_id, inicio, fim, motivo) VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
    [d.salaoId, d.profissionalId, d.inicio, d.fim, d.motivo ?? null],
  );
  return rows[0].id;
}

/** Apaga todos os bloqueios do salão (inclusive o da fábrica). */
export async function apagarBloqueios(c: pg.Client, salaoId: string): Promise<void> {
  await c.query('DELETE FROM bloqueio WHERE salao_id = $1', [salaoId]);
}

/** reserva e reserva_item do salão, byte a byte (to_jsonb), para provar que nada mudou (CA-4). */
export async function fotografiaReservas(c: pg.Client, salaoId: string): Promise<{ reservas: unknown[]; itens: unknown[] }> {
  const reservas = await c.query<{ j: unknown }>('SELECT to_jsonb(r) AS j FROM reserva r WHERE salao_id = $1 ORDER BY id', [salaoId]);
  const itens = await c.query<{ j: unknown }>('SELECT to_jsonb(i) AS j FROM reserva_item i WHERE salao_id = $1 ORDER BY id', [salaoId]);
  return { reservas: reservas.rows.map((r) => r.j), itens: itens.rows.map((r) => r.j) };
}

/** Linhas de `mensagem` (toda a base deste worker). */
export async function contarMensagens(c: pg.Client): Promise<number> {
  const { rows } = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM mensagem');
  return rows[0].n;
}

/** Anonimiza a cliente (nome e telefone nulos), como a E4.x fará. */
export async function anonimizarCliente(c: pg.Client, clienteId: string): Promise<void> {
  await c.query('UPDATE cliente SET nome = NULL, telefone_e164 = NULL, anonimizada_em = now() WHERE id = $1', [clienteId]);
}

/**
 * Reserva de UM item (D-050: o item tem o profissional, o período e o status; derivados coerentes),
 * por SQL, no status pedido. Devolve o id da reserva (o do item sai por `itemDe`).
 */
export async function criarReservaEm(
  c: pg.Client,
  d: {
    salaoId: string;
    profissionalId: string;
    clienteId: string;
    inicio: string | Date;
    fim: string | Date;
    ocupadoAte?: string | Date;
    status?: 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
  },
): Promise<string> {
  return inserirReserva(c, { ...d, status: d.status ?? 'confirmado' });
}

/** Id do (único) item da reserva. */
export async function itemDe(c: pg.Client, reservaId: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>('SELECT id::text AS id FROM reserva_item WHERE reserva_id = $1', [reservaId]);
  if (rows.length !== 1) throw new Error(`itemDe: ${rows.length} itens`);
  return rows[0].id;
}

/** Troca o fuso do salão direto no banco (E2.5 ainda não existe; CA-17). */
export async function definirFuso(c: pg.Client, salaoId: string, fuso: string): Promise<void> {
  await c.query('UPDATE salao SET fuso = $2 WHERE id = $1', [salaoId, fuso]);
}

/** Ativa ou desativa o perfil do profissional direto no banco. */
export async function definirAtivo(c: pg.Client, profissionalId: string, ativo: boolean): Promise<void> {
  await c.query('UPDATE profissional SET ativo = $2 WHERE id = $1', [profissionalId, ativo]);
}
