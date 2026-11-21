import { Prisma } from '@/generated/prisma/client';
import { exigirPublico } from '@/server/tenant/context';
import type { PublicoContext } from '@/server/tenant/context';

import { JUNCOES_AVALIACAO, ondeAvaliacaoVisivel } from './avaliacao-publica';
import { obterPrisma } from './db';

// Denúncia pública de avaliação (D-035, E8.4), partindo do PublicoContext do slug. Pré-contexto como
// avaliacao-publica.ts. UMA instrução, sem transação nem trava da avaliação (a FK só toma FOR KEY SHARE,
// que não conflita com o FOR NO KEY UPDATE; só o FOR UPDATE do moderador a faz esperar, sem ciclo).
// O predicado de visibilidade é o ÚNICO da leitura pública, então avaliação retirada, de outro salão,
// de reserva não concluída ou de cliente anonimizada não grava nada. A cláusula
// `WHERE resolvida_em IS NULL` do ON CONFLICT deve ficar LITERAL (alvo do índice único parcial
// `avaliacao_denuncia_pendente_uniq`); nunca capturar 23505. O teto é aproximado sob concorrência
// (algumas linhas acima de 20 são aceitas).

export type NovaDenuncia = {
  avaliacaoId: string;
  motivo: string;
  texto: string | null;
  ipHash: string;
  teto: number;
};

/** `true` se gravou; `false` (0 linhas) se a avaliação não é denunciável, já há pendente do IP ou o teto. */
export async function inserirDenunciaPublica(ctx: PublicoContext, d: NovaDenuncia): Promise<boolean> {
  const salaoId = exigirPublico(ctx);
  const linhas = await obterPrisma().$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO avaliacao_denuncia (salao_id, avaliacao_id, motivo, texto, ip_hash)
    SELECT a.salao_id, a.id, ${d.motivo}::motivo_denuncia_avaliacao, ${d.texto}::text, ${d.ipHash}::text
      FROM avaliacao a ${JUNCOES_AVALIACAO}
     WHERE ${ondeAvaliacaoVisivel(salaoId)} AND a.id = ${d.avaliacaoId}::uuid
       AND (SELECT count(*) FROM avaliacao_denuncia p
             WHERE p.avaliacao_id = a.id AND p.resolvida_em IS NULL) < ${d.teto}::int
    ON CONFLICT (avaliacao_id, ip_hash) WHERE resolvida_em IS NULL DO NOTHING
    RETURNING id`);
  return linhas.length > 0;
}
