import { Prisma } from '@/generated/prisma/client';
import type { EntradaAuditoriaValidada } from '@/server/auditoria/tipos';

import { obterPrisma } from './db';
import type { Executor } from './transacao';

// Auditoria (D-033, E8.1): este é o ÚNICO arquivo que toca a tabela `auditoria`, e só INSERE (os
// triggers do banco rejeitam UPDATE/DELETE/TRUNCATE). Sem escopo de tenant: a tabela é de plataforma
// e quem decide o ator é o serviço (`registrarAuditoria`, que exige AdminContext). Ordem de travas:
// ÚLTIMA; o INSERT só toma FOR KEY SHARE em usuario/salao (FK), que não conflita com NO KEY UPDATE.

export interface RepoAuditoria {
  /** INSERT único. A entrada vem validada pelo serviço; FK inexistente propaga como erro de banco. */
  inserir(e: EntradaAuditoriaValidada): Promise<{ id: string }>;
}

export function criarRepoAuditoria(db: Executor): RepoAuditoria {
  return {
    async inserir(e) {
      const linha = await db.auditoria.create({
        data: {
          atorId: e.atorId,
          atorEmailInformado: e.atorEmailInformado,
          acao: e.acao,
          entidade: e.entidade,
          entidadeId: e.entidadeId,
          salaoId: e.salaoId,
          antes: e.antes ?? Prisma.DbNull,
          depois: e.depois ?? Prisma.DbNull,
          resultado: e.resultado,
        },
        select: { id: true },
      });
      return { id: linha.id };
    },
  };
}

/**
 * INSERT em conexão própria do pool, fora de qualquer transação do chamador (resultado `falha`,
 * RN-2). Persiste mesmo se a transação principal sofrer rollback.
 */
export function inserirAuditoriaIndependente(e: EntradaAuditoriaValidada): Promise<{ id: string }> {
  return criarRepoAuditoria(obterPrisma()).inserir(e);
}

// ---------------------------------------------------------------------------------------------------------
// LEITURA pelo super admin (D-045, E8.3). Pré-contexto da plataforma, somente SELECT (a fronteira "só este arquivo toca
// `auditoria`" continua valendo). Mesma forma de plano da fila de mensagens (DBA §3): a página e o total são
// calculados só em `auditoria` (CTE da página + total `AS MATERIALIZED`); salão e usuário entram por JOIN só nas 20
// linhas. Filtro de ator: `ator_id IN (SELECT id FROM usuario WHERE email = …) OR ator_email_informado = …`.

export const POR_PAGINA = 20;

export type FiltrosAuditoriaRepo = {
  salaoId: string | null;
  /** E-mail exato em minúsculas. */
  ator: string | null;
  acao: string | null;
  resultado: string | null;
  /** Meio-aberto: `>= de` e `< ate`. */
  de: Date | null;
  ate: Date | null;
};

export type LinhaDaAuditoria = {
  id: string;
  acao: string;
  entidade: string | null;
  entidadeId: string | null;
  resultado: string;
  ocorridoEm: Date;
  salaoId: string | null;
  salaoNome: string | null;
  atorEmail: string | null;
  antes: unknown;
  depois: unknown;
};

type LinhaBruta = {
  total: number;
  id: string | null;
  acao: string | null;
  entidade: string | null;
  entidade_id: string | null;
  resultado: string | null;
  ocorrido_em: Date | null;
  salao_id: string | null;
  salao_nome: string | null;
  ator_email: string | null;
  antes: unknown;
  depois: unknown;
};

/** A instrução da auditoria (exportada para o teste de plano `EXPLAIN` usar exatamente o mesmo texto). */
export function consultaDaAuditoria(f: FiltrosAuditoriaRepo, deslocamento: number): Prisma.Sql {
  return Prisma.sql`
    WITH f AS MATERIALIZED (
      SELECT a.id, a.ator_id, a.ator_email_informado, a.acao, a.entidade, a.entidade_id, a.salao_id,
             a.antes, a.depois, a.resultado, a.ocorrido_em
        FROM auditoria a
       WHERE (${f.salaoId}::uuid IS NULL OR a.salao_id = ${f.salaoId}::uuid)
         AND (${f.acao}::text IS NULL OR a.acao = ${f.acao}::text)
         AND (${f.resultado}::text IS NULL OR a.resultado::text = ${f.resultado}::text)
         AND (${f.de}::timestamptz IS NULL OR a.ocorrido_em >= ${f.de}::timestamptz)
         AND (${f.ate}::timestamptz IS NULL OR a.ocorrido_em < ${f.ate}::timestamptz)
         AND (${f.ator}::text IS NULL
              OR a.ator_id IN (SELECT u.id FROM usuario u WHERE u.email = ${f.ator}::text)
              OR a.ator_email_informado = ${f.ator}::text)
       ORDER BY a.ocorrido_em DESC, a.id DESC
       LIMIT ${POR_PAGINA}::int OFFSET ${deslocamento}::bigint
    ), t AS MATERIALIZED (
      SELECT count(*)::int AS total
        FROM auditoria a
       WHERE (${f.salaoId}::uuid IS NULL OR a.salao_id = ${f.salaoId}::uuid)
         AND (${f.acao}::text IS NULL OR a.acao = ${f.acao}::text)
         AND (${f.resultado}::text IS NULL OR a.resultado::text = ${f.resultado}::text)
         AND (${f.de}::timestamptz IS NULL OR a.ocorrido_em >= ${f.de}::timestamptz)
         AND (${f.ate}::timestamptz IS NULL OR a.ocorrido_em < ${f.ate}::timestamptz)
         AND (${f.ator}::text IS NULL
              OR a.ator_id IN (SELECT u.id FROM usuario u WHERE u.email = ${f.ator}::text)
              OR a.ator_email_informado = ${f.ator}::text)
    )
    SELECT t.total, f.id::text AS id, f.acao, f.entidade, f.entidade_id, f.resultado::text AS resultado,
           f.ocorrido_em, f.salao_id::text AS salao_id, s.nome AS salao_nome,
           COALESCE(u.email, f.ator_email_informado) AS ator_email, f.antes, f.depois
      FROM t
      LEFT JOIN f ON true
      LEFT JOIN salao s ON s.id = f.salao_id
      LEFT JOIN usuario u ON u.id = f.ator_id
     ORDER BY f.ocorrido_em DESC, f.id DESC`;
}

export async function listarAuditoria(
  f: FiltrosAuditoriaRepo,
  deslocamento: number,
  db: Executor = obterPrisma(),
): Promise<{ itens: LinhaDaAuditoria[]; total: number }> {
  const linhas = await db.$queryRaw<LinhaBruta[]>(consultaDaAuditoria(f, deslocamento));
  return {
    total: linhas[0]?.total ?? 0,
    itens: linhas
      .filter((l) => l.id !== null)
      .map((l) => ({
        id: l.id as string,
        acao: l.acao as string,
        entidade: l.entidade,
        entidadeId: l.entidade_id,
        resultado: l.resultado as string,
        ocorridoEm: l.ocorrido_em as Date,
        salaoId: l.salao_id,
        salaoNome: l.salao_nome,
        atorEmail: l.ator_email,
        antes: l.antes,
        depois: l.depois,
      })),
  };
}
