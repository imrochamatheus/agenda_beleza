import { Prisma } from '@/generated/prisma/client';
import { exigirPublico } from '@/server/tenant/context';
import type { PublicoContext } from '@/server/tenant/context';

import { obterPrisma } from './db';

// Leituras públicas das avaliações (D-032), partindo do PublicoContext do slug. Fora do escopo de
// tenant como repos/publico.ts. O predicado de visibilidade é ÚNICO (`ondeAvaliacaoVisivel`) e vale
// para média, contagem e lista: avaliação não retirada, de reserva `concluido`, de cliente não
// anonimizada (RN-9). Ignora suspensão e pendência do salão (RN-11). Projeção mínima: nunca
// cliente_id, reserva_id, telefone nem data exata.

/** Junções por (salao_id, id), como o resto do esquema (FKs compostas). */
export const JUNCOES_AVALIACAO = Prisma.sql`
  JOIN reserva r ON r.salao_id = a.salao_id AND r.id = a.reserva_id
  JOIN cliente c ON c.salao_id = a.salao_id AND c.id = a.cliente_id`;

/** Predicado único de visibilidade, com o escopo do salão. Usa o alias `a`, `r` e `c`. */
export function ondeAvaliacaoVisivel(salaoId: string): Prisma.Sql {
  return Prisma.sql`a.salao_id = ${salaoId}::uuid AND a.retirada_em IS NULL
    AND r.status = 'concluido' AND c.anonimizada_em IS NULL`;
}

export type AvaliacaoLida = { id: string; nome: string; nota: number; comentario: string | null; criadoEm: Date };
export type AvaliacoesLidas = { fuso: string; total: number; media: number | null; itens: AvaliacaoLida[] };

type LinhaLeitura = {
  fuso: string;
  total: number;
  media: number | null;
  itens: { id: string; nome: string | null; nota: number; comentario: string | null; criado_em: string }[];
};

/** Uma instrução: contagem, média (1 casa, meio para cima do numeric) e as últimas `limite`. */
export async function lerPublicas(ctx: PublicoContext, limite: number): Promise<AvaliacoesLidas> {
  const salaoId = exigirPublico(ctx);
  const n = Math.max(0, Math.min(100, Math.trunc(limite)));
  const onde = ondeAvaliacaoVisivel(salaoId);
  const linhas = await obterPrisma().$queryRaw<LinhaLeitura[]>`
    SELECT
      (SELECT fuso FROM salao WHERE id = ${salaoId}::uuid) AS fuso,
      (SELECT count(*)::int FROM avaliacao a ${JUNCOES_AVALIACAO} WHERE ${onde}) AS total,
      (SELECT round(avg(a.nota)::numeric, 1)::float8 FROM avaliacao a ${JUNCOES_AVALIACAO} WHERE ${onde}) AS media,
      (SELECT coalesce(json_agg(l ORDER BY l.criado_em DESC, l.id DESC), '[]'::json)
         FROM (SELECT a.id, a.nome_exibicao AS nome, a.nota::int AS nota, a.comentario, a.criado_em
                 FROM avaliacao a ${JUNCOES_AVALIACAO}
                WHERE ${onde}
                ORDER BY a.criado_em DESC, a.id DESC
                LIMIT ${n}) l) AS itens`;
  const l = linhas[0];
  return {
    fuso: l.fuso,
    total: l.total,
    media: l.media,
    itens: l.itens.map((i) => ({
      id: i.id,
      nome: i.nome ?? 'Cliente',
      nota: i.nota,
      comentario: i.comentario,
      criadoEm: new Date(i.criado_em),
    })),
  };
}

/**
 * Verificação do link (RN-5), uma instrução de forma fixa: devolve o nome do salão só se o convite
 * existe no salão, não foi usado nem invalidado, `agora < expira_em`, a reserva é `concluido` e a
 * cliente não está anonimizada. Todo outro caso é `null` (resposta uniforme). Sem trava.
 */
export async function buscarConviteValido(
  ctx: PublicoContext,
  tokenHash: string,
  agora: Date,
): Promise<{ nomeSalao: string } | null> {
  const salaoId = exigirPublico(ctx);
  const linhas = await obterPrisma().$queryRaw<{ nome: string }[]>`
    SELECT s.nome
      FROM avaliacao_convite v
      JOIN reserva r ON r.salao_id = v.salao_id AND r.id = v.reserva_id
      JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
      JOIN salao s ON s.id = v.salao_id
     WHERE v.salao_id = ${salaoId}::uuid AND v.token_hash = ${tokenHash}
       AND v.usado_em IS NULL AND v.invalidado_em IS NULL AND v.expira_em > ${agora}::timestamptz
       AND r.status = 'concluido' AND c.anonimizada_em IS NULL`;
  return linhas.length === 0 ? null : { nomeSalao: linhas[0].nome };
}
