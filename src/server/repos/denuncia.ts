import { Prisma } from '@/generated/prisma/client';
import { POR_PAGINA_FILA } from '@/server/denuncias/tipos';
import type {
  DenunciaDoDetalhe,
  DetalheDaAvaliacao,
  EstadoFila,
  ItemDaFila,
  MotivoDenuncia,
  Resolucao,
} from '@/server/denuncias/tipos';
import { exigirAdmin } from '@/server/tenant/context';
import type { AdminContext } from '@/server/tenant/context';

import { ehUuid } from './ids';
import type { Executor } from './transacao';

// Denúncias de avaliações para o super admin (D-035, E8.4). Repositório de PLATAFORMA: recebe
// AdminContext (o admin não tem salão; os repositórios de tenant nunca o aceitam). Ordem de travas:
// a avaliação `FOR UPDATE` vem ANTES (RepoAvaliacao.travarParaModerar); aqui só há UPDATE das
// denúncias e leituras sem trava. `resolvida_em IS NULL` fica LITERAL em todo SQL (índices parciais).
// Nunca expõe cliente_id, telefone nem e-mail: só nome de exibição e comentário, já públicos.

export type FiltroDaFila = { salaoId: string | null; estado: EstadoFila | null; pagina: number };

export interface RepoDenuncia {
  /**
   * Resolve as denúncias PENDENTES da avaliação (todas, ou só `denunciaId`) com `resolvida_em`,
   * `resolucao` e `resolvida_por` juntos (o CHECK recusa parcial). Devolve quantas resolveu.
   */
  resolverPendentes(
    ctx: AdminContext,
    d: { avaliacaoId: string; denunciaId?: string; resolucao: Resolucao; agora: Date },
  ): Promise<number>;
  /** Avaliações do filtro, `criado_em DESC, id DESC`, 20 por página, total na MESMA instrução. */
  fila(ctx: AdminContext, f: FiltroDaFila): Promise<{ total: number; itens: ItemDaFila[] }>;
  /** Avaliação e todas as suas denúncias (resolvidas ou não); `null` se não existe. */
  detalhe(ctx: AdminContext, avaliacaoId: string): Promise<DetalheDaAvaliacao | null>;
}

type LinhaFila = {
  id: string;
  salao_id: string;
  salao_nome: string;
  nota: number;
  nome: string | null;
  comentario: string | null;
  criado_em: string;
  retirada_em: string | null;
  pendentes: number;
  motivos: MotivoDenuncia[];
  nao_publicada: boolean;
};

const paraItem = (l: LinhaFila): ItemDaFila => ({
  id: l.id,
  salaoId: l.salao_id,
  salaoNome: l.salao_nome,
  nota: l.nota,
  nome: l.nome,
  comentario: l.comentario,
  criadoEm: new Date(l.criado_em),
  retiradaEm: l.retirada_em === null ? null : new Date(l.retirada_em),
  pendentes: l.pendentes,
  motivos: l.motivos,
  naoPublicada: l.nao_publicada,
});

const COLUNAS = Prisma.sql`
  a.id, a.salao_id, s.nome AS salao_nome, a.nota::int AS nota, a.nome_exibicao AS nome, a.comentario,
  a.criado_em, a.retirada_em,
  (SELECT count(*)::int FROM avaliacao_denuncia d WHERE d.avaliacao_id = a.id AND d.resolvida_em IS NULL) AS pendentes,
  coalesce((SELECT array_agg(DISTINCT d.motivo::text ORDER BY d.motivo::text) FROM avaliacao_denuncia d
             WHERE d.avaliacao_id = a.id AND d.resolvida_em IS NULL), ARRAY[]::text[]) AS motivos,
  (r.status <> 'concluido' OR c.anonimizada_em IS NOT NULL) AS nao_publicada`;

const JUNCOES = Prisma.sql`
  FROM avaliacao a
  JOIN salao s ON s.id = a.salao_id
  JOIN reserva r ON r.salao_id = a.salao_id AND r.id = a.reserva_id
  JOIN cliente c ON c.salao_id = a.salao_id AND c.id = a.cliente_id`;

function condicoes(f: FiltroDaFila): Prisma.Sql {
  const partes: Prisma.Sql[] = [Prisma.sql`true`];
  if (f.salaoId !== null) partes.push(Prisma.sql`a.salao_id = ${f.salaoId}::uuid`);
  if (f.estado === 'visivel') partes.push(Prisma.sql`a.retirada_em IS NULL`);
  if (f.estado === 'retirada') partes.push(Prisma.sql`a.retirada_em IS NOT NULL`);
  if (f.estado === 'com_denuncia_pendente') {
    partes.push(Prisma.sql`EXISTS (SELECT 1 FROM avaliacao_denuncia d WHERE d.avaliacao_id = a.id AND d.resolvida_em IS NULL)`);
  }
  return Prisma.join(partes, ' AND ');
}

export function criarRepoDenuncia(db: Executor): RepoDenuncia {
  return {
    async resolverPendentes(ctx, d) {
      const adminId = exigirAdmin(ctx);
      if (!ehUuid(d.avaliacaoId) || (d.denunciaId !== undefined && !ehUuid(d.denunciaId))) return 0;
      const soEsta = d.denunciaId === undefined ? Prisma.empty : Prisma.sql`AND id = ${d.denunciaId}::uuid`;
      return db.$executeRaw(Prisma.sql`
        UPDATE avaliacao_denuncia
           SET resolvida_em = ${d.agora}::timestamptz, resolucao = ${d.resolucao}::text, resolvida_por = ${adminId}::uuid
         WHERE avaliacao_id = ${d.avaliacaoId}::uuid AND resolvida_em IS NULL ${soEsta}`);
    },

    async fila(ctx, f) {
      exigirAdmin(ctx);
      const deslocamento = (f.pagina - 1) * POR_PAGINA_FILA;
      const linhas = await db.$queryRaw<{ total: number; itens: LinhaFila[] }[]>(Prisma.sql`
        WITH f AS (SELECT ${COLUNAS} ${JUNCOES} WHERE ${condicoes(f)})
        SELECT (SELECT count(*)::int FROM f) AS total,
               (SELECT coalesce(json_agg(l ORDER BY l.criado_em DESC, l.id DESC), '[]'::json)
                  FROM (SELECT * FROM f ORDER BY criado_em DESC, id DESC
                         LIMIT ${POR_PAGINA_FILA}::int OFFSET ${deslocamento}::int) l) AS itens`);
      return { total: linhas[0].total, itens: linhas[0].itens.map(paraItem) };
    },

    async detalhe(ctx, avaliacaoId) {
      exigirAdmin(ctx);
      if (!ehUuid(avaliacaoId)) return null;
      const linhas = await db.$queryRaw<LinhaFila[]>(Prisma.sql`
        SELECT ${COLUNAS} ${JUNCOES} WHERE a.id = ${avaliacaoId}::uuid`);
      if (linhas.length === 0) return null;
      const den = await db.$queryRaw<
        { id: string; motivo: MotivoDenuncia; texto: string | null; criado_em: Date; resolvida_em: Date | null; resolucao: Resolucao | null }[]
      >`SELECT id, motivo::text AS motivo, texto, criado_em, resolvida_em, resolucao
          FROM avaliacao_denuncia WHERE avaliacao_id = ${avaliacaoId}::uuid
         ORDER BY criado_em DESC, id DESC`;
      const { pendentes: _p, motivos: _m, ...item } = paraItem(linhas[0]);
      void _p;
      void _m;
      const denuncias: DenunciaDoDetalhe[] = den.map((x) => ({
        id: x.id,
        motivo: x.motivo,
        texto: x.texto,
        criadoEm: x.criado_em,
        resolvidaEm: x.resolvida_em,
        resolucao: x.resolucao,
      }));
      return { ...item, denuncias };
    },
  };
}
