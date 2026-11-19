import { verificarBanco } from '@/server/health';

import { obterPrisma } from './db';

/**
 * Responde se o PostgreSQL de DATABASE_URL atende um `SELECT 1` dentro do timeout do health.
 * Nunca lança: DATABASE_URL ausente ou banco inacessível devolvem false.
 */
export async function bancoDisponivel(): Promise<boolean> {
  try {
    return await verificarBanco(obterPrisma());
  } catch {
    // DATABASE_URL ausente: o banco é tratado como indisponível.
    return false;
  }
}
