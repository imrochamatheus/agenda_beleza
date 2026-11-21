import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import { TOKEN_TURNSTILE_SIMULADO } from '@/server/integrations/turnstile/port';
import { criarGeradorLink } from '@/server/avaliacoes/convite';
import { enviarAvaliacao } from '@/server/avaliacoes/servico';
import type { DependenciasAvaliacao } from '@/server/avaliacoes/servico';
import type { EntradaEnvio } from '@/server/avaliacoes/tipos';
import { hashDoToken } from '@/server/avaliacoes/token';
import { criarPublicoContext, contextoDeSistema } from '@/server/tenant/context';

import { criarSalaoCompleto, instanteFuturo } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { ipNovo } from '../../support/reserva-publica';
import { telefoneNovo } from '../../support/sql';

// Apoio local aos testes de tests/integration/avaliacoes (D-032). Não é arquivo de teste. SQL direto pelo
// driver `pg`, sem mocks de banco; o link vem do gerador REAL com relógio, segredo e APP_URL injetados.

export const AGORA = new Date('2026-11-22T12:00:00Z');
export const DIA_MS = 86_400_000;
export const SEGREDO_TESTE = 'segredo-de-teste-da-avaliacao-0123456789abcdef';
export const APP_URL_TESTE = 'https://app.exemplo.test';

export const gerador = (agora: Date = AGORA, segredo: string = SEGREDO_TESTE) =>
  criarGeradorLink({ agora: () => agora, segredo: () => segredo, appUrl: () => APP_URL_TESTE });

export const salaoNovo = (sobre: Parameters<typeof criarSalaoCompleto>[0] = {}): Promise<SalaoCompleto> => criarSalaoCompleto(sobre);

export const ctxPublico = (s: Pick<SalaoCompleto, 'salaoId' | 'slugAtual'>) => criarPublicoContext(s.salaoId, s.slugAtual);

let dia = 10;

export type Avaliavel = { clienteId: string; reservaId: string; telefone: string };

/** Cliente + reserva (por padrão `concluido`) no salão. */
export async function criarAvaliavel(
  c: pg.Client,
  s: SalaoCompleto,
  o: { nome?: string | null; status?: 'confirmado' | 'concluido' | 'nao_compareceu' | 'cancelado' } = {},
): Promise<Avaliavel> {
  const telefone = telefoneNovo();
  const { rows } = await c.query<{ id: string }>(
    'INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, $2, $3) RETURNING id::text AS id',
    [s.salaoId, o.nome === undefined ? 'Maria Souza' : o.nome, telefone],
  );
  const clienteId = rows[0].id;
  const inicio = instanteFuturo((dia += 1), 13);
  const fim = new Date(inicio.getTime() + 3_600_000);
  const r = await c.query<{ id: string }>(
    `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
     VALUES ($1, $2, $3, $4, $5, $5, $6, 'equipe') RETURNING id::text AS id`,
    [s.salaoId, s.gestor.profissionalId, clienteId, inicio, fim, o.status ?? 'concluido'],
  );
  return { clienteId, reservaId: r.rows[0].id, telefone };
}

export const ctxSistema = (s: Pick<SalaoCompleto, 'salaoId'>) => contextoDeSistema(s.salaoId, 'teste');

/** Gera o link como o worker (gerador real) e devolve também o token em claro. */
export async function emitirLink(s: SalaoCompleto, reservaId: string, agora: Date = AGORA): Promise<{ link: string; token: string }> {
  const link = await gerador(agora)(ctxSistema(s), reservaId);
  return { link, token: link.slice(link.lastIndexOf('/') + 1) };
}

export function entradaEnvio(s: Pick<SalaoCompleto, 'slugAtual'>, token: string, sobre: Partial<EntradaEnvio> = {}): EntradaEnvio {
  return {
    slug: s.slugAtual,
    token,
    nota: '4',
    comentario: 'Atendimento ótimo!',
    aceite: 'on',
    ip: ipNovo(),
    tokenHumano: TOKEN_TURNSTILE_SIMULADO,
    ...sobre,
  };
}

export const enviar = (
  s: Pick<SalaoCompleto, 'slugAtual'>,
  token: string,
  sobre: Partial<EntradaEnvio> = {},
  agora: Date = AGORA,
  deps: DependenciasAvaliacao = {},
) => enviarAvaliacao(entradaEnvio(s, token, sobre), agora, deps);

export async function contar(c: pg.Client, tabela: 'avaliacao' | 'avaliacao_convite', salaoId: string): Promise<number> {
  const { rows } = await c.query<{ n: string }>(`SELECT count(*) AS n FROM ${tabela} WHERE salao_id = $1`, [salaoId]);
  return Number(rows[0].n);
}

/** Fotografia (to_jsonb) de avaliacao e convite do salão: prova de "nada foi gravado". */
export async function fotografia(c: pg.Client, salaoId: string): Promise<string> {
  const { rows } = await c.query<{ t: string }>(
    `SELECT to_jsonb(x)::text AS t FROM avaliacao x WHERE salao_id = $1
     UNION ALL SELECT to_jsonb(x)::text FROM avaliacao_convite x WHERE salao_id = $1 ORDER BY 1`,
    [salaoId],
  );
  return rows.map((r) => r.t).join('\n');
}

export async function conviteDe(c: pg.Client, reservaId: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await c.query<{ j: Record<string, unknown> }>('SELECT to_jsonb(x) AS j FROM avaliacao_convite x WHERE reserva_id = $1', [reservaId]);
  return rows[0]?.j;
}

export const hashDe = hashDoToken;
export const novoUuid = randomUUID;
