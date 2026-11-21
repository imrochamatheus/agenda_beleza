import { z } from 'zod';

import * as ambienteArmazenamento from './integrations/armazenamento/ambiente';
import * as ambienteEmail from './integrations/email/ambiente';
import * as ambienteMercadoPago from './integrations/mercadopago/ambiente';
import * as ambienteTurnstile from './integrations/turnstile/ambiente';
import * as ambienteWhatsApp from './integrations/whatsapp/ambiente';

/** Valores aceitos pelos seletores de adaptador. */
export const ADAPTADORES = ['simulado', 'real'] as const;
export type Modo = (typeof ADAPTADORES)[number];

/** Texto só de dígitos convertido em inteiro na faixa [min, max]. */
function inteiroEntre(min: number, max: number) {
  return z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.int().min(min).max(max));
}

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
  STORAGE_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
  // Fila (D-008 RN-9/RN-10). Só dígitos: '-1', '1.5', ' 4' e 'abc' são recusados.
  QUEUE_RETRY_LIMIT: inteiroEntre(0, 20).default(4),
  QUEUE_RETRY_DELAY_SECONDS: inteiroEntre(1, 3600).default(30),
  QUEUE_RETRY_BACKOFF: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Vitrine /dev/componentes (D-009 D-1). Só valida o formato (falha cedo com TRUE, 1, sim...);
  // a página lê a variável na requisição por `vitrineHabilitada`. Não entra no Env.
  VITRINE_COMPONENTES: z.enum(['true', 'false']).default('false'),
  // Proteção da página pública (D-027). `RATE_LIMIT_SEGREDO` é obrigatório só em produção (validarEnv).
  TRUSTED_PROXY_HOPS: inteiroEntre(0, 10).default(0),
  RATE_LIMIT_SEGREDO: z.string().min(32).optional(),
  // Segredo HMAC dos links de avaliação (D-032); obrigatório só em produção (validarEnv). Não entra no Env.
  AVALIACAO_SEGREDO: z.string().min(32).optional(),
  PROTECAO_JANELA_SEGUNDOS: inteiroEntre(60, 86400).default(900),
  PROTECAO_LIMITE_IP_RESERVA: inteiroEntre(1, 100000).default(10),
  PROTECAO_LIMITE_IP_DISPONIBILIDADE: inteiroEntre(1, 100000).default(60),
  PROTECAO_LIMITE_IP_AVALIACAO: inteiroEntre(1, 100000).default(5),
  PROTECAO_LIMITE_IP_DENUNCIA: inteiroEntre(1, 100000).default(5),
  PROTECAO_LIMITE_NUMERO: inteiroEntre(1, 100000).default(5),
});

export type ConfigIntegracao<C> = { modo: 'simulado' } | { modo: 'real'; config: C };

export type ConfigProtecao = {
  /** Entradas confiáveis do `X-Forwarded-For` contadas da direita; 0 ignora o cabeçalho. */
  proxyHops: number;
  janelaSegundos: number;
  limiteIp: { reserva: number; disponibilidade: number; avaliacao: number; denuncia: number };
  limiteNumero: number;
};

export type Env = {
  DATABASE_URL: string;
  APP_URL: string;
  /** Política de retry da fila (D-008 RN-9): lida só por `politicaDeRetry` (src/server/queue/config.ts). */
  fila: { retryLimit: number; retryDelaySeconds: number; retryBackoff: boolean };
  integracoes: {
    email: ConfigIntegracao<ambienteEmail.ConfigSmtp>;
    turnstile: ConfigIntegracao<ambienteTurnstile.ConfigTurnstile>;
    mercadoPago: ConfigIntegracao<ambienteMercadoPago.ConfigMercadoPagoReal>;
    whatsapp: ConfigIntegracao<ambienteWhatsApp.ConfigWhatsAppReal>;
    armazenamento: ConfigIntegracao<ambienteArmazenamento.ConfigS3>;
  };
};

type NomeIntegracao = keyof Env['integracoes'];
export type Seletor = 'EMAIL_ADAPTER' | 'WHATSAPP_ADAPTER' | 'MP_ADAPTER' | 'TURNSTILE_ADAPTER' | 'STORAGE_ADAPTER';

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
  armazenamento: ambienteArmazenamento,
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
  const armazenamento = lerIntegracao(entrada, MODULOS.armazenamento, erros);

  if (entrada.NODE_ENV === 'production' && entrada.RATE_LIMIT_SEGREDO === undefined) {
    erros.push('RATE_LIMIT_SEGREDO');
  }
  if (entrada.NODE_ENV === 'production' && entrada.AVALIACAO_SEGREDO === undefined) {
    erros.push('AVALIACAO_SEGREDO');
  }

  if (erros.length > 0 || !base.success || !email || !turnstile || !mercadoPago || !whatsapp || !armazenamento) {
    throw new ErroDeAmbiente(erros);
  }
  return {
    DATABASE_URL: base.data.DATABASE_URL,
    APP_URL: base.data.APP_URL,
    fila: {
      retryLimit: base.data.QUEUE_RETRY_LIMIT,
      retryDelaySeconds: base.data.QUEUE_RETRY_DELAY_SECONDS,
      retryBackoff: base.data.QUEUE_RETRY_BACKOFF,
    },
    integracoes: { email, turnstile, mercadoPago, whatsapp, armazenamento },
  };
}

type DadosProtecao = Pick<
  z.output<typeof esquemaEnv>,
  | 'TRUSTED_PROXY_HOPS'
  | 'PROTECAO_JANELA_SEGUNDOS'
  | 'PROTECAO_LIMITE_IP_RESERVA'
  | 'PROTECAO_LIMITE_IP_DISPONIBILIDADE'
  | 'PROTECAO_LIMITE_IP_AVALIACAO'
  | 'PROTECAO_LIMITE_IP_DENUNCIA'
  | 'PROTECAO_LIMITE_NUMERO'
>;

function protecaoDe(d: DadosProtecao): ConfigProtecao {
  return {
    proxyHops: d.TRUSTED_PROXY_HOPS,
    janelaSegundos: d.PROTECAO_JANELA_SEGUNDOS,
    limiteIp: {
      reserva: d.PROTECAO_LIMITE_IP_RESERVA,
      disponibilidade: d.PROTECAO_LIMITE_IP_DISPONIBILIDADE,
      avaliacao: d.PROTECAO_LIMITE_IP_AVALIACAO,
      denuncia: d.PROTECAO_LIMITE_IP_DENUNCIA,
    },
    limiteNumero: d.PROTECAO_LIMITE_NUMERO,
  };
}

/**
 * Lê só a proteção da página pública (D-027), sem exigir DATABASE_URL nem os adaptadores: a página e o
 * worker a chamam a cada uso. Valor inválido lança ErroDeAmbiente nomeando a variável.
 */
export function lerProtecao(fonte: Record<string, string | undefined>): ConfigProtecao {
  const parcial = esquemaEnv.pick({
    TRUSTED_PROXY_HOPS: true,
    PROTECAO_JANELA_SEGUNDOS: true,
    PROTECAO_LIMITE_IP_RESERVA: true,
    PROTECAO_LIMITE_IP_DISPONIBILIDADE: true,
    PROTECAO_LIMITE_IP_AVALIACAO: true,
    PROTECAO_LIMITE_IP_DENUNCIA: true,
    PROTECAO_LIMITE_NUMERO: true,
  });
  const r = parcial.safeParse(semVazias(fonte));
  if (!r.success) throw new ErroDeAmbiente(r.error.issues.map((i) => String(i.path[0])));
  return protecaoDe(r.data);
}

export type ModosAtivos = { armazenamento: Modo; email: Modo; mercadoPago: Modo; turnstile: Modo; whatsapp: Modo };

/** Modo ativo de cada integração, sem nenhum valor de configuração (seguro para log). */
export function modosAtivos(env: Env): ModosAtivos {
  const { armazenamento, email, mercadoPago, turnstile, whatsapp } = env.integracoes;
  // Ordem alfabética: é a ordem das chaves no evento worker.adaptadores.
  return {
    armazenamento: armazenamento.modo,
    email: email.modo,
    mercadoPago: mercadoPago.modo,
    turnstile: turnstile.modo,
    whatsapp: whatsapp.modo,
  };
}

/**
 * D-009 D-1: a vitrine /dev/componentes responde só com o texto exato
 * `VITRINE_COMPONENTES=true` ou com `NODE_ENV=development` (next dev). Não valida o resto do
 * ambiente: é lida na requisição pela página, sem depender de banco nem de adaptadores.
 */
export function vitrineHabilitada(fonte: Record<string, string | undefined>): boolean {
  return fonte.VITRINE_COMPONENTES === 'true' || fonte.NODE_ENV === 'development';
}
