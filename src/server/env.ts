import { z } from 'zod';

/** Valores aceitos pelos seletores de adaptador (RN-1). `real` ainda não tem efeito na E0.2. */
export const ADAPTADORES = ['simulado', 'real'] as const;

/**
 * Variáveis lidas pelo runtime da app e do worker.
 * Nada é validado no import (RN-6): a validação roda só em `validarEnv`.
 */
export const esquemaEnv = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
  EMAIL_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
  WHATSAPP_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
  MP_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
  TURNSTILE_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
});
export type Env = z.infer<typeof esquemaEnv>;

/** Chaves do .env.example que o runtime da app não lê (S-3): usadas pelo compose ou pelos testes. */
export const CHAVES_FORA_DO_RUNTIME = [
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'POSTGRES_PORT',
  'TEST_DATABASE_URL',
] as const;

/** União comparada pelo teste de CA-3 com as chaves do .env.example. */
export function chavesDeclaradas(): string[] {
  return [...Object.keys(esquemaEnv.shape), ...CHAVES_FORA_DO_RUNTIME];
}

export class ErroDeAmbiente extends Error {
  /** Nomes das variáveis inválidas, ordenados. */
  readonly variaveis: string[];

  constructor(variaveis: string[]) {
    const ordenadas = [...variaveis].sort();
    super(`Variáveis de ambiente ausentes ou inválidas: ${ordenadas.join(', ')}`);
    this.name = 'ErroDeAmbiente';
    this.variaveis = ordenadas;
  }
}

/**
 * Valida o ambiente. Uma string vazia conta como ausente.
 * Lança ErroDeAmbiente cuja mensagem nomeia cada variável inválida, nunca o valor
 * (DATABASE_URL contém senha).
 */
export function validarEnv(fonte: Record<string, string | undefined>): Env {
  const entrada: Record<string, string | undefined> = {};
  for (const chave of Object.keys(esquemaEnv.shape)) {
    const valor = fonte[chave];
    entrada[chave] = valor === '' ? undefined : valor;
  }
  const resultado = esquemaEnv.safeParse(entrada);
  if (!resultado.success) {
    const nomes = new Set(resultado.error.issues.map((issue) => String(issue.path[0])));
    throw new ErroDeAmbiente([...nomes]);
  }
  return resultado.data;
}
