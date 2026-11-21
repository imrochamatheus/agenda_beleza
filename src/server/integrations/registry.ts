import { type ConfigIntegracao, ErroDeAmbiente, type Modo, validarEnv } from '@/server/env';

import type { ConfigS3 } from './armazenamento/ambiente';
import { DIRETORIO_PADRAO } from './armazenamento/ambiente';
import type { PortaArmazenamento } from './armazenamento/port';
import { criarArmazenamentoReal } from './armazenamento/real';
import { criarArmazenamentoSimulado } from './armazenamento/simulado';
import type { ConfigSmtp } from './email/ambiente';
import type { PortaEmail } from './email/port';
import { criarEmailReal } from './email/real';
import { criarEmailSimulado } from './email/simulado';
import type { PortaMercadoPago } from './mercadopago/port';
import { criarMercadoPagoReal } from './mercadopago/real';
import { criarMercadoPagoSimulado } from './mercadopago/simulado';
import type { ConfigTurnstile } from './turnstile/ambiente';
import type { PortaTurnstile } from './turnstile/port';
import { criarTurnstileReal } from './turnstile/real';
import { criarTurnstileSimulado } from './turnstile/simulado';
import type { PortaWhatsApp } from './whatsapp/port';
import { criarWhatsAppReal } from './whatsapp/real';
import { criarWhatsAppSimulado } from './whatsapp/simulado';

// Registro das integrações (RN-14, D-007 §3.11). Única porta de entrada da lógica de negócio para
// os adaptadores: ela importa só este arquivo e os tipos das portas (o lint RN-16 garante).
// O import NÃO lê o ambiente nem valida nada (CA-6, CA-10): a validação roda em
// `criarIntegracoes` ou no primeiro uso de `integracoes()`.

export type { Modo };

export interface Integracoes {
  readonly email: PortaEmail;
  readonly whatsapp: PortaWhatsApp;
  readonly mercadoPago: PortaMercadoPago;
  readonly turnstile: PortaTurnstile;
  readonly armazenamento: PortaArmazenamento;
  readonly modos: Readonly<{ email: Modo; whatsapp: Modo; mercadoPago: Modo; turnstile: Modo; armazenamento: Modo }>;
}

type Fonte = Record<string, string | undefined>;

/** E-mail: simulado grava em email_log; real usa a ConfigSmtp validada (sem `exigirTls`, que é só de teste). */
export function selecionarEmail(c: ConfigIntegracao<ConfigSmtp>): PortaEmail {
  return c.modo === 'real' ? criarEmailReal(c.config) : criarEmailSimulado();
}

/**
 * Turnstile. No real, a chave do site é lida de `lerAmbiente()` a CADA chamada (CA-14), nunca
 * no build nem na construção. Vazia ou ausente na chamada → ErroDeAmbiente(['TURNSTILE_SITE_KEY']).
 */
export function selecionarTurnstile(
  c: ConfigIntegracao<ConfigTurnstile>,
  lerAmbiente: () => Fonte = () => process.env,
): PortaTurnstile {
  if (c.modo === 'simulado') return criarTurnstileSimulado();
  return criarTurnstileReal({
    segredo: c.config.segredo,
    lerChaveDoSite: () => {
      const chave = lerAmbiente().TURNSTILE_SITE_KEY;
      if (chave === undefined || chave === '') throw new ErroDeAmbiente(['TURNSTILE_SITE_KEY']);
      return chave;
    },
  });
}

/**
 * Mercado Pago. `real` liga o stub NaoImplementado de `mercadopago/real.ts` (CA-9), embora o
 * `validarEnv` ainda recuse MP_ADAPTER=real (D-1). A E6.6 passa a repassar a config aqui.
 */
export function selecionarMercadoPago(modo: Modo, o: { appUrl: string }): PortaMercadoPago {
  return modo === 'real' ? criarMercadoPagoReal() : criarMercadoPagoSimulado({ appUrl: o.appUrl });
}

/**
 * Armazenamento (D-021). Simulado grava em `ARMAZENAMENTO_DIR` (padrão `.armazenamento`) e ignora
 * as `S3_*`; real usa a ConfigS3 validada.
 */
export function selecionarArmazenamento(c: ConfigIntegracao<ConfigS3>, fonte: Fonte): PortaArmazenamento {
  if (c.modo === 'real') return criarArmazenamentoReal(c.config);
  const dir = fonte.ARMAZENAMENTO_DIR;
  return criarArmazenamentoSimulado({ diretorio: dir === undefined || dir === '' ? DIRETORIO_PADRAO : dir });
}

/** WhatsApp. `real` liga o stub NaoImplementado de `whatsapp/real.ts` (CA-9; E7.2). */
export function selecionarWhatsApp(modo: Modo): PortaWhatsApp {
  return modo === 'real' ? criarWhatsAppReal() : criarWhatsAppSimulado();
}

/**
 * Valida `fonte` (um único ErroDeAmbiente com todas as variáveis inválidas) e constrói as cinco
 * portas. A leitura da chave do site do Turnstile consulta `fonte` na chamada: com `process.env`
 * (caso de `integracoes()`), o valor é o vigente em runtime.
 */
export function criarIntegracoes(fonte: Fonte): Integracoes {
  const env = validarEnv(fonte);
  const { email, whatsapp, mercadoPago, turnstile, armazenamento } = env.integracoes;
  return {
    email: selecionarEmail(email),
    whatsapp: selecionarWhatsApp(whatsapp.modo),
    mercadoPago: selecionarMercadoPago(mercadoPago.modo, { appUrl: env.APP_URL }),
    turnstile: selecionarTurnstile(turnstile, () => fonte),
    armazenamento: selecionarArmazenamento(armazenamento, fonte),
    modos: {
      email: email.modo,
      whatsapp: whatsapp.modo,
      mercadoPago: mercadoPago.modo,
      turnstile: turnstile.modo,
      armazenamento: armazenamento.modo,
    },
  };
}

// Estado do módulo (não globalThis): o objeto é barato e o hot reload pode reconstruí-lo.
let memo: Integracoes | null = null;

/**
 * Integrações do processo, sobre `process.env`, construídas no PRIMEIRO uso e memoizadas.
 * Ambiente inválido → ErroDeAmbiente (nada é memoizado; a chamada seguinte valida de novo).
 */
export function integracoes(): Integracoes {
  memo ??= criarIntegracoes(process.env);
  return memo;
}

/** Descarta a memoização (testes). */
export function redefinirIntegracoes(): void {
  memo = null;
}
