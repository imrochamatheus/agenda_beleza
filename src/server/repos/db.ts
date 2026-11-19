import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';

/** Tempo máximo para abrir uma conexão; fica abaixo do timeout do health (3 s) somado à folga do compose. */
const TIMEOUT_CONEXAO_MS = 3000;

/** Tamanho do pool de produção. É o padrão do `pg`, declarado aqui para não depender dele. */
export const POOL_MAX_PADRAO = 10;

export type OpcoesPool = { max: number };

/** Cache por URL em globalThis, para o hot reload do Next não abrir um pool por recarga. */
const globalComCache = globalThis as typeof globalThis & {
  __clientesPrisma?: Map<string, PrismaClient>;
};

/** Tamanho do pool dos clientes criados a partir de agora (ver `configurarPool`). */
let poolMax = POOL_MAX_PADRAO;

function cache(): Map<string, PrismaClient> {
  globalComCache.__clientesPrisma ??= new Map();
  return globalComCache.__clientesPrisma;
}

function validarMax(max: number): number {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error('max do pool deve ser um inteiro positivo');
  }
  return max;
}

/**
 * Define o tamanho do pool dos clientes criados **depois** desta chamada (por `criarPrisma` sem `max`
 * e por `obterPrisma`). Clientes já em cache mantêm o pool com que foram criados. Usado pelo harness
 * de testes (pool maior que o de produção para os testes de concorrência).
 */
export function configurarPool(opcoes: OpcoesPool): void {
  poolMax = validarMax(opcoes.max);
}

/** Configuração do pool `pg` entregue ao adaptador; `max` omitido usa o valor de `configurarPool`. */
export function configuracaoDoAdaptador(
  url: string,
  opcoes: Partial<OpcoesPool> = {},
): { connectionString: string; connectionTimeoutMillis: number; max: number } {
  return {
    connectionString: url,
    connectionTimeoutMillis: TIMEOUT_CONEXAO_MS,
    max: validarMax(opcoes.max ?? poolMax),
  };
}

export function criarPrisma(url: string, opcoes: Partial<OpcoesPool> = {}): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(configuracaoDoAdaptador(url, opcoes)) });
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
