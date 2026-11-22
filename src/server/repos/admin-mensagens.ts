import { Prisma } from '@/generated/prisma/client';

import { obterPrisma } from './db';
import type { Executor } from './transacao';

// Fila global de mensagens vista pelo super admin (D-045, E8.3). Repositório PRÉ-CONTEXTO da plataforma
// (como admin-saloes.ts): só é chamado depois de `exigirAdmin` no serviço; o admin não tem salão. A
// projeção NUNCA seleciona `parametros`, `provedor_mensagem_id`, `erro_detalhe`, chave de idempotência,
// id da reserva/cliente nem nome da cliente. `destinatario_e164` e `anonimizada_em` saem daqui só para o
// serviço aplicar a máscara (o DTO público não os tem).
//
// Plano (parecer do DBA, docs/demandas/D-045/dba.md §2): NUNCA `count(*) OVER ()` sobre o JOIN. A página
// (LIMIT/OFFSET) é calculada só em `mensagem`, o total é uma CTE `AS MATERIALIZED` (senão é reavaliada por
// linha) e o JOIN de salão/reserva/cliente acontece só nas 20 linhas; tudo numa instrução. Os literais
// `m.estado::text = $x` são parâmetros porque a fila global não usa índice parcial.

export const POR_PAGINA = 20;

export type FiltrosFila = { estado: string | null; tipo: string | null; salaoId: string | null };

export type LinhaDaFila = {
  id: string;
  salaoId: string;
  salaoNome: string;
  tipo: string;
  revisao: number;
  estado: string;
  erroCodigo: string | null;
  /** Só para o serviço mascarar. */
  destinatarioE164: string | null;
  /** Só para o serviço decidir "Cliente removida". */
  clienteAnonimizada: boolean;
  criadaEm: Date;
  atualizadaEm: Date;
  enviadaEm: Date | null;
};

type LinhaBruta = {
  total: number;
  id: string | null;
  salao_id: string | null;
  salao_nome: string | null;
  tipo: string | null;
  revisao: number | null;
  estado: string | null;
  erro_codigo: string | null;
  destinatario_e164: string | null;
  anonimizada: boolean | null;
  criada_em: Date | null;
  atualizada_em: Date | null;
  enviada_em: Date | null;
};

function mapear(l: LinhaBruta): LinhaDaFila {
  return {
    id: l.id as string,
    salaoId: l.salao_id as string,
    salaoNome: l.salao_nome as string,
    tipo: l.tipo as string,
    revisao: l.revisao as number,
    estado: l.estado as string,
    erroCodigo: l.erro_codigo,
    destinatarioE164: l.destinatario_e164,
    clienteAnonimizada: l.anonimizada === true,
    criadaEm: l.criada_em as Date,
    atualizadaEm: l.atualizada_em as Date,
    enviadaEm: l.enviada_em,
  };
}

/** A instrução da fila (exportada para o teste de plano `EXPLAIN` usar exatamente o mesmo texto). */
export function consultaDaFila(f: FiltrosFila, deslocamento: number): Prisma.Sql {
  return Prisma.sql`
    WITH f AS MATERIALIZED (
      SELECT m.id, m.salao_id, m.reserva_id, m.tipo, m.revisao, m.estado, m.erro_codigo,
             m.destinatario_e164, m.criado_em, m.atualizado_em, m.enviada_em
        FROM mensagem m
       WHERE (${f.estado}::text IS NULL OR m.estado::text = ${f.estado}::text)
         AND (${f.tipo}::text IS NULL OR m.tipo::text = ${f.tipo}::text)
         AND (${f.salaoId}::uuid IS NULL OR m.salao_id = ${f.salaoId}::uuid)
       ORDER BY m.criado_em DESC, m.id DESC
       LIMIT ${POR_PAGINA}::int OFFSET ${deslocamento}::bigint
    ), t AS MATERIALIZED (
      SELECT count(*)::int AS total
        FROM mensagem m
       WHERE (${f.estado}::text IS NULL OR m.estado::text = ${f.estado}::text)
         AND (${f.tipo}::text IS NULL OR m.tipo::text = ${f.tipo}::text)
         AND (${f.salaoId}::uuid IS NULL OR m.salao_id = ${f.salaoId}::uuid)
    )
    SELECT t.total, f.id::text AS id, f.salao_id::text AS salao_id, s.nome AS salao_nome, f.tipo::text AS tipo,
           f.revisao, f.estado::text AS estado, f.erro_codigo, f.destinatario_e164,
           (c.anonimizada_em IS NOT NULL) AS anonimizada,
           f.criado_em AS criada_em, f.atualizado_em AS atualizada_em, f.enviada_em
      FROM t
      LEFT JOIN f ON true
      LEFT JOIN salao s ON s.id = f.salao_id
      LEFT JOIN reserva r ON r.salao_id = f.salao_id AND r.id = f.reserva_id
      LEFT JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
     ORDER BY f.criado_em DESC, f.id DESC`;
}

/**
 * Página da fila + total em UM comando. Sem linhas na página (além do fim), vem UMA linha com `id` nulo e o
 * total (`t LEFT JOIN`), para a tela mostrar o link da primeira página sem segunda consulta.
 */
export async function listarFila(
  f: FiltrosFila,
  deslocamento: number,
  db: Executor = obterPrisma(),
): Promise<{ itens: LinhaDaFila[]; total: number }> {
  const linhas = await db.$queryRaw<LinhaBruta[]>(consultaDaFila(f, deslocamento));
  return {
    total: linhas[0]?.total ?? 0,
    itens: linhas.filter((l) => l.id !== null).map(mapear),
  };
}

/** Uma mensagem com a mesma projeção da fila (confirmação e detalhe). Inexistente → null. */
export async function lerMensagemDaFila(id: string, db: Executor = obterPrisma()): Promise<LinhaDaFila | null> {
  const linhas = await db.$queryRaw<LinhaBruta[]>`
    SELECT 1::int AS total, m.id::text AS id, m.salao_id::text AS salao_id, s.nome AS salao_nome, m.tipo::text AS tipo,
           m.revisao, m.estado::text AS estado, m.erro_codigo, m.destinatario_e164,
           (c.anonimizada_em IS NOT NULL) AS anonimizada,
           m.criado_em AS criada_em, m.atualizado_em AS atualizada_em, m.enviada_em
      FROM mensagem m
      JOIN salao s ON s.id = m.salao_id
      JOIN reserva r ON r.salao_id = m.salao_id AND r.id = m.reserva_id
      JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
     WHERE m.id = ${id}::uuid`;
  return linhas[0] === undefined ? null : mapear(linhas[0]);
}

export type LinhaDeTentativa = {
  numero: number;
  iniciadaEm: Date;
  finalizadaEm: Date | null;
  resultado: string | null;
  erroCodigo: string | null;
};

/** Tentativas por `numero`; nunca `erro_detalhe`. */
export async function listarTentativas(mensagemId: string, db: Executor = obterPrisma()): Promise<LinhaDeTentativa[]> {
  const linhas = await db.$queryRaw<
    { numero: number; iniciada_em: Date; finalizada_em: Date | null; resultado: string | null; erro_codigo: string | null }[]
  >`
    SELECT numero, iniciada_em, finalizada_em, resultado::text AS resultado, erro_codigo
      FROM mensagem_tentativa
     WHERE mensagem_id = ${mensagemId}::uuid
     ORDER BY numero`;
  return linhas.map((l) => ({
    numero: l.numero,
    iniciadaEm: l.iniciada_em,
    finalizadaEm: l.finalizada_em,
    resultado: l.resultado,
    erroCodigo: l.erro_codigo,
  }));
}

/** Salão dono da mensagem (pré-contexto do reenvio). Inexistente → null. */
export async function salaoDaMensagem(id: string, db: Executor = obterPrisma()): Promise<string | null> {
  const [l] = await db.$queryRaw<{ salao_id: string }[]>`SELECT salao_id::text AS salao_id FROM mensagem WHERE id = ${id}::uuid`;
  return l?.salao_id ?? null;
}
