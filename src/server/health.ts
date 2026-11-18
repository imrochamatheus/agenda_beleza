import type { PrismaClient } from '@/generated/prisma/client';

/** Fica abaixo do timeout de 5 s do healthcheck do compose e do limite do CA-5. */
export const TIMEOUT_HEALTH_MS = 3000;

/** Só o necessário do cliente: permite exercitar o timeout com uma consulta que nunca responde. */
type ConsultaBruta = Pick<PrismaClient, '$queryRaw'>;

/** Executa `SELECT 1` em corrida com o timeout. Devolve true se o banco respondeu; nunca lança. */
export async function verificarBanco(
  prisma: ConsultaBruta,
  timeoutMs: number = TIMEOUT_HEALTH_MS,
): Promise<boolean> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<boolean>((resolver) => {
    temporizador = setTimeout(() => resolver(false), timeoutMs);
  });
  const consulta = Promise.resolve()
    .then(() => prisma.$queryRaw`SELECT 1`)
    .then(
      () => true,
      () => false,
    );
  try {
    return await Promise.race([consulta, limite]);
  } finally {
    clearTimeout(temporizador);
  }
}
