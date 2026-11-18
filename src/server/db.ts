import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';

/** Tempo máximo para abrir uma conexão; fica abaixo do timeout do health (3 s) somado à folga do compose. */
const TIMEOUT_CONEXAO_MS = 3000;

/** Cache por URL em globalThis, para o hot reload do Next não abrir um pool por recarga. */
const globalComCache = globalThis as typeof globalThis & {
  __clientesPrisma?: Map<string, PrismaClient>;
};

function cache(): Map<string, PrismaClient> {
  globalComCache.__clientesPrisma ??= new Map();
  return globalComCache.__clientesPrisma;
}

export function criarPrisma(url: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: TIMEOUT_CONEXAO_MS }),
  });
}

/**
 * Devolve o cliente da URL informada (padrão: DATABASE_URL, lida na chamada, nunca no import).
 * Lança um erro se não houver URL; a mensagem não traz valores.
 */
export function obterPrisma(url: string | undefined = process.env.DATABASE_URL): PrismaClient {
  if (!url) {
    throw new Error('DATABASE_URL não definida');
  }
  const clientes = cache();
  let cliente = clientes.get(url);
  if (!cliente) {
    cliente = criarPrisma(url);
    clientes.set(url, cliente);
  }
  return cliente;
}

/** Desconecta e esquece todos os clientes do cache (testes e, na E0.7, o worker). */
export async function encerrarPrisma(): Promise<void> {
  const clientes = cache();
  const ativos = [...clientes.values()];
  clientes.clear();
  await Promise.all(ativos.map((cliente) => cliente.$disconnect()));
}
