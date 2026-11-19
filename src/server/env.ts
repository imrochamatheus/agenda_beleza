import { z } from 'zod';

import * as ambienteEmail from './integrations/email/ambiente';
import * as ambienteMercadoPago from './integrations/mercadopago/ambiente';
import * as ambienteTurnstile from './integrations/turnstile/ambiente';
import * as ambienteWhatsApp from './integrations/whatsapp/ambiente';

/** Valores aceitos pelos seletores de adaptador. */
export const ADAPTADORES = ['simulado', 'real'] as const;
export type Modo = (typeof ADAPTADORES)[number];

/**
 * Variáveis base lidas pelo runtime da app e do worker, mais os 4 seletores.
 * As variáveis de cada provedor NÃO entram aqui: são lidas por `lerConfigReal` do módulo
 * `<integração>/ambiente.ts`, e só no modo `real` (no simulado são ignoradas; CA-8).
 * Nada é validado no import (RN-5): a validação roda só em `validarEnv`.
 */
export const esquemaEnv = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
  EMAIL_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
  WHATSAPP_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
  MP_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
  TURNSTILE_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
});

export type ConfigIntegracao<C> = { modo: 'simulado' } | { modo: 'real'; config: C };

export type Env = {
  DATABASE_URL: string;
  APP_URL: string;
  integracoes: {
    email: ConfigIntegracao<ambienteEmail.ConfigSmtp>;
    turnstile: ConfigIntegracao<ambienteTurnstile.ConfigTurnstile>;
    mercadoPago: ConfigIntegracao<ambienteMercadoPago.ConfigMercadoPagoReal>;
    whatsapp: ConfigIntegracao<ambienteWhatsApp.ConfigWhatsAppReal>;
  };
};

type NomeIntegracao = keyof Env['integracoes'];
export type Seletor = 'EMAIL_ADAPTER' | 'WHATSAPP_ADAPTER' | 'MP_ADAPTER' | 'TURNSTILE_ADAPTER';

/** Contrato comum dos módulos `<integração>/ambiente.ts`. */
type ModuloAmbiente<C> = {
  SELETOR: Seletor;
  CHAVES: readonly string[];
  lerConfigReal(
    fonte: Record<string, string | undefined>,
  ): { ok: true; config: C } | { ok: false; variaveis: string[] };
};

const MODULOS = {
  email: ambienteEmail,
  turnstile: ambienteTurnstile,
  mercadoPago: ambienteMercadoPago,
  whatsapp: ambienteWhatsApp,
} satisfies { [N in NomeIntegracao]: ModuloAmbiente<unknown> };

/** Chaves do .env.example que o runtime da app não lê (S-3): usadas pelo compose ou pelos testes. */
export const CHAVES_FORA_DO_RUNTIME = [
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'POSTGRES_PORT',
  'TEST_DATABASE_URL',
] as const;

/** União comparada pelo teste com as chaves do .env.example (CA-25). */
export function chavesDeclaradas(): string[] {
  return [
    ...Object.keys(esquemaEnv.shape),
    ...Object.values(MODULOS).flatMap((m) => [...m.CHAVES]),
    ...CHAVES_FORA_DO_RUNTIME,
  ];
}

export class ErroDeAmbiente extends Error {
  /** Nomes das variáveis inválidas, ordenados. */
  readonly variaveis: string[];

  constructor(variaveis: string[]) {
    const ordenadas = [...new Set(variaveis)].sort();
    super(`Variáveis de ambiente ausentes ou inválidas: ${ordenadas.join(', ')}`);
    this.name = 'ErroDeAmbiente';
    this.variaveis = ordenadas;
  }
}

/** Cópia da fonte com string vazia convertida em ausente (regra vigente). */
function semVazias(fonte: Record<string, string | undefined>): Record<string, string | undefined> {
  const saida: Record<string, string | undefined> = {};
  for (const [chave, valor] of Object.entries(fonte)) saida[chave] = valor === '' ? undefined : valor;
  return saida;
}

/**
 * Modo pedido por um seletor, sem validar o resto do ambiente.
 * Ausente ou vazio → 'simulado'; valor desconhecido → null.
 */
export function modoSelecionado(
  fonte: Record<string, string | undefined>,
  seletor: Seletor,
): Modo | null {
  const valor = fonte[seletor];
  if (valor === undefined || valor === '') return 'simulado';
  return (ADAPTADORES as readonly string[]).includes(valor) ? (valor as Modo) : null;
}

/** Lê uma integração; acumula em `erros` as variáveis inválidas do modo real. */
function lerIntegracao<C>(
  fonte: Record<string, string | undefined>,
  modulo: ModuloAmbiente<C>,
  erros: string[],
): ConfigIntegracao<C> | null {
  const modo = modoSelecionado(fonte, modulo.SELETOR);
  // Seletor inválido: o esquemaEnv já o nomeia.
  if (modo === null) return null;
  if (modo === 'simulado') return { modo };
  const lido = modulo.lerConfigReal(fonte);
  if (!lido.ok) {
    erros.push(...lido.variaveis);
    return null;
  }
  return { modo, config: lido.config };
}

/**
 * Valida o ambiente: base (zod), seletores e, para cada integração em `real`, as exigências do
 * provedor. Uma string vazia conta como ausente. Lança um único ErroDeAmbiente que nomeia TODAS
 * as variáveis inválidas, ordenadas, nunca os valores (DATABASE_URL e as credenciais são segredos).
 */
export function validarEnv(fonte: Record<string, string | undefined>): Env {
  const entrada = semVazias(fonte);
  const erros: string[] = [];

  const base = esquemaEnv.safeParse(entrada);
  if (!base.success) erros.push(...base.error.issues.map((issue) => String(issue.path[0])));

  const email = lerIntegracao(entrada, MODULOS.email, erros);
  const turnstile = lerIntegracao(entrada, MODULOS.turnstile, erros);
  const mercadoPago = lerIntegracao(entrada, MODULOS.mercadoPago, erros);
  const whatsapp = lerIntegracao(entrada, MODULOS.whatsapp, erros);

  if (!base.success || !email || !turnstile || !mercadoPago || !whatsapp) {
    throw new ErroDeAmbiente(erros);
  }
  return {
    DATABASE_URL: base.data.DATABASE_URL,
    APP_URL: base.data.APP_URL,
    integracoes: { email, turnstile, mercadoPago, whatsapp },
  };
}

export type ModosAtivos = { email: Modo; mercadoPago: Modo; turnstile: Modo; whatsapp: Modo };

/** Modo ativo de cada integração, sem nenhum valor de configuração (seguro para log). */
export function modosAtivos(env: Env): ModosAtivos {
  const { email, mercadoPago, turnstile, whatsapp } = env.integracoes;
  // Ordem alfabética: é a ordem das chaves no evento worker.adaptadores.
  return {
    email: email.modo,
    mercadoPago: mercadoPago.modo,
    turnstile: turnstile.modo,
    whatsapp: whatsapp.modo,
  };
}
