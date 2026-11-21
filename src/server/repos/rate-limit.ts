import { obterPrisma } from './db';

// Contadores por janela fixa em `rate_limit_janela` (D-010 §3.6; a E4.2 reaproveita). Repositório de
// plataforma, sem ContextoEscopado (a tabela não pertence a um salão; exceção documentada, como
// sessao.ts). A chave nunca traz dado pessoal em claro (o chamador passa um hash).

/**
 * Incremento atômico (uma instrução, sem leitura prévia): cria a janela com 1 ou soma 1. Devolve o
 * contador depois do incremento. Concorrentes nunca perdem incremento (CA-12).
 */
export async function incrementarJanela(chave: string, janelaInicio: Date): Promise<number> {
  const [linha] = await obterPrisma().$queryRaw<{ contador: number }[]>`
    INSERT INTO rate_limit_janela (chave, janela_inicio, contador)
    VALUES (${chave}::text, ${janelaInicio}::timestamptz, 1)
    ON CONFLICT (chave, janela_inicio)
    DO UPDATE SET contador = rate_limit_janela.contador + 1
    RETURNING contador`;
  return linha.contador;
}

/** Devolve uma unidade da janela (sem ficar negativo). Janela inexistente: nada acontece. */
export async function decrementarJanela(chave: string, janelaInicio: Date): Promise<void> {
  await obterPrisma().$executeRaw`
    UPDATE rate_limit_janela
       SET contador = GREATEST(contador - 1, 0)
     WHERE chave = ${chave}::text AND janela_inicio = ${janelaInicio}::timestamptz`;
}

/**
 * Apaga até `lote` linhas com `janela_inicio < corte` (índice `rate_limit_janela_janela_inicio_idx`).
 * `SKIP LOCKED` evita esperar linhas travadas; janelas vigentes nunca entram (corte injetado, UTC).
 * Devolve quantas apagou (D-027, parecer do DBA).
 */
export async function removerExpiradas(corte: Date, lote: number): Promise<number> {
  if (!Number.isInteger(lote) || lote < 1) throw new RangeError('lote inválido');
  return obterPrisma().$executeRaw`
    WITH l AS (
      SELECT chave, janela_inicio FROM rate_limit_janela
       WHERE janela_inicio < ${corte}::timestamptz
       ORDER BY janela_inicio
       LIMIT ${lote}::int
       FOR UPDATE SKIP LOCKED)
    DELETE FROM rate_limit_janela r USING l
     WHERE r.chave = l.chave AND r.janela_inicio = l.janela_inicio`;
}
