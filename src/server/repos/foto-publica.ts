import { obterPrisma } from './db';
import { ehUuid } from './ids';

// Leitura PRÉ-CONTEXTO da chave de uma foto por id (D-021 §3.5; RN-14). Exceção documentada à RN-8 da
// D-005 (como sessao.ts e token-*.ts): a entrega pública não tem sessão e o id é global. Não filtra
// suspensão. Não é exposto em `Repos`. Nunca devolve salão, texto ou posição: só a chave.

/** Chave do objeto da foto, ou null (id malformado ou inexistente; nada é consultado se malformado). */
export async function buscarChaveDaFoto(id: string): Promise<string | null> {
  if (!ehUuid(id)) {
    return null;
  }
  const linhas = await obterPrisma().$queryRaw<{ chave: string }[]>`
    SELECT chave FROM salao_foto WHERE id = ${id}::uuid`;
  return linhas[0]?.chave ?? null;
}
