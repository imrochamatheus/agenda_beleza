import { chaveIp, chaveNumero } from '@/server/protecao/chaves';
import { obterPrisma } from '@/server/repos/db';

/** Contador atual (0 se a linha não existe) da chave, somando todas as janelas. */
export async function contadorDa(chave: string): Promise<number> {
  const linhas = await obterPrisma().$queryRaw<{ total: bigint | null }[]>`
    SELECT sum(contador) AS total FROM rate_limit_janela WHERE chave = ${chave}::text`;
  return Number(linhas[0]?.total ?? 0);
}

export const contadorDoIp = (ip: string, escopo: Parameters<typeof chaveIp>[0] = 'reserva') => contadorDa(chaveIp(escopo, ip));
export const contadorDoNumero = (salaoId: string, e164: string) => contadorDa(chaveNumero(salaoId, e164));
