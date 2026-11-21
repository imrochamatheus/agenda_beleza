import type pg from 'pg';

import { criarAdminContext } from '@/server/tenant/context';
import type { AdminContext } from '@/server/tenant/context';

import { hashDaSenhaDeTeste } from './factories';
import { emailNovo } from './sql';

// Apoio dos testes da auditoria (D-033). Leitura por SQL direto; o código de produção só insere.

export type LinhaAuditoria = {
  id: string;
  ator_id: string | null;
  ator_email_informado: string | null;
  acao: string;
  entidade: string | null;
  entidade_id: string | null;
  salao_id: string | null;
  antes: unknown;
  depois: unknown;
  resultado: string;
  ocorrido_em: Date;
};

/** Cria um super admin (usuario papel super_admin, sem salão) e devolve o contexto. */
export async function criarSuperAdmin(c: pg.Client): Promise<{ usuarioId: string; ctx: AdminContext }> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO usuario (papel, email, nome, senha_hash, email_confirmado_em)
     VALUES ('super_admin', $1, 'Admin de teste', $2, now()) RETURNING id`,
    [emailNovo(), await hashDaSenhaDeTeste()],
  );
  return { usuarioId: rows[0].id, ctx: criarAdminContext(rows[0].id) };
}

export async function linhasDeAuditoria(c: pg.Client, onde: string, params: unknown[]): Promise<LinhaAuditoria[]> {
  const { rows } = await c.query<LinhaAuditoria>(
    `SELECT id::text, ator_id::text, ator_email_informado, acao, entidade, entidade_id, salao_id::text,
            antes, depois, resultado::text, ocorrido_em
       FROM auditoria WHERE ${onde} ORDER BY ocorrido_em, id`,
    params,
  );
  return rows;
}

export async function contarAuditoria(c: pg.Client): Promise<number> {
  const { rows } = await c.query<{ n: string }>('SELECT count(*) AS n FROM auditoria');
  return Number(rows[0].n);
}
