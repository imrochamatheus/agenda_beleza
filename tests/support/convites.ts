import type pg from 'pg';

import { chaveDeConvite } from '@/server/auth/convite';
import { gerarToken } from '@/server/auth/sessao';
import { convidar } from '@/server/convites/servico';
import type { ResultadoConvidar } from '@/server/convites/tipos';
import type { TenantContext } from '@/server/tenant/context';

import { emailNovo } from './sql';

// Apoio dos testes do convite de profissional (D-039). SQL direto pelo driver `pg` na base do worker.

export const APP_URL = 'http://app.teste';
export const T0 = new Date('2026-11-19T12:00:00.000Z');
export const DIA_MS = 24 * 60 * 60 * 1000;
export const MIN_MS = 60_000;

/** Profissional novo, ativo e sem usuário, com e-mail novo por padrão (`null` = sem e-mail). */
export async function novoProfissionalSemAcesso(
  c: pg.Client,
  salaoId: string,
  o: { email?: string | null; ativo?: boolean; nome?: string } = {},
): Promise<{ id: string; email: string | null }> {
  const email = o.email === undefined ? emailNovo() : o.email;
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO profissional (salao_id, nome, email, ativo) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
    [salaoId, o.nome ?? 'Convidada de teste', email, o.ativo ?? true],
  );
  return { id: rows[0].id, email };
}

export type LinhaConvite = {
  id: string;
  email: string;
  token_hash: string;
  expira_em: Date;
  aceito_em: Date | null;
  invalidado_em: Date | null;
};

export async function convitesDe(c: pg.Client, profissionalId: string): Promise<LinhaConvite[]> {
  const { rows } = await c.query<LinhaConvite>(
    `SELECT id::text AS id, email, token_hash, expira_em, aceito_em, invalidado_em
       FROM convite WHERE profissional_id = $1 ORDER BY criado_em, id`,
    [profissionalId],
  );
  return rows;
}

export const pendentes = (l: LinhaConvite[]) => l.filter((x) => x.aceito_em === null && x.invalidado_em === null);

export async function emailsDe(c: pg.Client, destinatario: string): Promise<{ assunto: string; corpo: string }[]> {
  const { rows } = await c.query<{ assunto: string; corpo: string }>(
    'SELECT assunto, corpo FROM email_log WHERE destinatario = $1 ORDER BY criado_em, id',
    [destinatario],
  );
  return rows;
}

/** Token do link do último e-mail enviado ao destinatário (ou undefined). */
export async function tokenDoUltimoEmail(c: pg.Client, destinatario: string): Promise<string | undefined> {
  const e = (await emailsDe(c, destinatario)).at(-1);
  return e ? new RegExp(`${APP_URL}/convite/([A-Za-z0-9_-]{43})`).exec(e.corpo)?.[1] : undefined;
}

export async function linhasDeUsuario(c: pg.Client, email: string) {
  const { rows } = await c.query<{
    id: string;
    salao_id: string | null;
    papel: string;
    nome: string;
    senha_hash: string;
    email_confirmado_em: Date | null;
  }>(`SELECT id::text AS id, salao_id::text AS salao_id, papel::text AS papel, nome, senha_hash, email_confirmado_em FROM usuario WHERE email = $1`, [email]);
  return rows;
}

export async function contadorDaJanela(c: pg.Client, profissionalId: string): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    'SELECT COALESCE(sum(contador), 0)::int AS n FROM rate_limit_janela WHERE chave = $1',
    [chaveDeConvite(profissionalId)],
  );
  return rows[0].n;
}

/** Convida pelo serviço (relógio e URL injetados) e devolve o resultado e o token em claro. */
export async function emitirConvite(
  ctx: TenantContext,
  profissionalId: string,
  agora: Date = T0,
): Promise<{ r: ResultadoConvidar; token: string }> {
  const token = gerarToken();
  const r = await convidar(ctx, { id: profissionalId }, agora, { appUrl: APP_URL, gerarToken: () => token, log: () => {} });
  return { r, token };
}
