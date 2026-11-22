import { obterPrisma } from './db';
import type { Executor } from './transacao';

// Opções do filtro de salão das telas globais do admin (D-045 §3). Pré-contexto da plataforma.

/** Até `limite + 1` salões por nome (o serviço decide `select` × código ao ver o excedente). */
export async function listarSaloesParaFiltro(limite: number, db: Executor = obterPrisma()): Promise<{ id: string; nome: string }[]> {
  return db.$queryRaw<{ id: string; nome: string }[]>`
    SELECT id::text AS id, nome FROM salao ORDER BY nome COLLATE "C", id LIMIT ${limite + 1}::int`;
}
