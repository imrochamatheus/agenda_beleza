import { z } from 'zod';

import { DIAS_TESTE, PRECO_MENSAL_CENTAVOS } from '@/config/plano';

import {
  type AssinaturaProvedor,
  type EstadoAssinaturaProvedor,
  ErroProvedor,
  type PagamentoProvedor,
} from './port';

// D-046: ÚNICO lugar com nomes de campos, valores e enumerações do Mercado Pago. Puro: sem rede,
// sem ambiente, sem relógio. Tudo o que a documentação não confirma está marcado NÃO CONFIRMADO
// (README, "Pendente de validação no sandbox") e é trocável aqui sem tocar o resto do adaptador.

/**
 * Como a assinatura é criada (design §1, D-1). `com_plano` (padrão): `preapproval_plan_id` sem cartão;
 * `sem_plano`: `auto_recurring` com `free_trial` no próprio corpo. NÃO CONFIRMADO qual a conta do MP
 * aceita sem `card_token_id`: o spike de sandbox (E9.3) decide e a troca é editar esta constante.
 */
export type EstrategiaCriacao = 'com_plano' | 'sem_plano';
export const ESTRATEGIA_CRIACAO: EstrategiaCriacao = 'com_plano';

export const MOTIVO_ASSINATURA = 'Assinatura Agenda Beleza';

/** Caminho (sob a URL base) do endpoint de notificações da D-041, anexado a `APP_URL`. */
export const CAMINHO_WEBHOOK = '/api/webhooks/mercadopago';

export type EntradaCorpoCriacao = {
  planoId: string;
  emailPagador: string;
  salaoId: string;
  urlRetorno: string;
  /** NÃO CONFIRMADO (R-5): `notification_url` no preapproval. Omitido quando ausente. */
  urlNotificacao?: string;
};

export function montarCorpoCriacao(
  estrategia: EstrategiaCriacao,
  e: EntradaCorpoCriacao,
): Record<string, unknown> {
  const comum = {
    reason: MOTIVO_ASSINATURA,
    external_reference: e.salaoId,
    payer_email: e.emailPagador,
    back_url: e.urlRetorno,
    status: 'pending',
    ...(e.urlNotificacao === undefined ? {} : { notification_url: e.urlNotificacao }),
  };
  if (estrategia === 'com_plano') return { preapproval_plan_id: e.planoId, ...comum };
  return {
    ...comum,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: PRECO_MENSAL_CENTAVOS / 100,
      currency_id: 'BRL',
      free_trial: { frequency: DIAS_TESTE, frequency_type: 'days' },
    },
  };
}

/** NÃO CONFIRMADO: `next_payment_date` não é parâmetro documentado do PUT (RN-4: o adaptador confere por consulta). */
export function montarCorpoAdiamento(novaData: Date): Record<string, unknown> {
  return { next_payment_date: novaData.toISOString() };
}

export function montarCorpoCancelamento(): Record<string, unknown> {
  return { status: 'cancelled' };
}

// --- Webhook -------------------------------------------------------------------------------

/**
 * Manifest assinado pelo MP: `id:<data.id da query>;request-id:<x-request-id>;ts:<ts>;`. Pares
 * ausentes são omitidos (regra documentada). `ts` é o texto BRUTO do cabeçalho.
 */
export function montarManifesto(p: { dataId?: string; requestId?: string; ts?: string }): string {
  let m = '';
  if (p.dataId !== undefined) m += `id:${p.dataId};`;
  if (p.requestId !== undefined) m += `request-id:${p.requestId};`;
  if (p.ts !== undefined) m += `ts:${p.ts};`;
  return m;
}

/** `ts` em segundos (10 dígitos) ou milissegundos (13): abaixo de 1e11 é segundos. */
export function tsParaMs(ts: string): number {
  const n = Number(ts);
  return n < 1e11 ? n * 1000 : n;
}

// --- Respostas -----------------------------------------------------------------------------

const TEXTO = z.string().min(1);
const NUMERO_OU_TEXTO = z.union([z.number(), z.string().min(1)]);
const DATA = z.string().min(1).nullish();

const ESQUEMA_PREAPPROVAL = z.looseObject({
  id: TEXTO,
  status: TEXTO,
  external_reference: TEXTO,
  init_point: z.string().nullish(),
  date_created: DATA,
  last_modified: DATA,
  next_payment_date: DATA,
  auto_recurring: z.looseObject({ transaction_amount: NUMERO_OU_TEXTO }),
});

const ESQUEMA_PAGAMENTO = z.looseObject({
  id: NUMERO_OU_TEXTO,
  preapproval_id: TEXTO,
  status: TEXTO,
  transaction_amount: NUMERO_OU_TEXTO,
  debit_date: DATA,
  date_created: DATA,
  last_modified: DATA,
  payment: z.looseObject({ status: z.string().nullish() }).nullish(),
});

const ESTADO_POR_STATUS: Readonly<Record<string, EstadoAssinaturaProvedor>> = {
  pending: 'pendente',
  authorized: 'autorizada',
  cancelled: 'cancelada',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function erro(): ErroProvedor {
  return new ErroProvedor('Resposta inesperada do provedor de pagamento.');
}

function parse<T extends z.ZodType>(esquema: T, json: unknown): z.infer<T> {
  const r = esquema.safeParse(json);
  if (!r.success) throw erro();
  return r.data;
}

function data(v: string | null | undefined): Date | null {
  if (v === undefined || v === null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw erro();
  return d;
}

function centavos(v: string | number): number {
  const n = Math.round(Number(v) * 100);
  if (!Number.isFinite(n) || n < 0) throw erro();
  return n;
}

export function lerInitPoint(json: unknown): string | null {
  const v = typeof json === 'object' && json !== null ? (json as Record<string, unknown>).init_point : undefined;
  if (typeof v !== 'string') return null;
  try {
    return new URL(v).protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
}

/** Id do recurso na criação: `id` não vazio. */
export function lerIdCriado(json: unknown): string {
  return parse(z.looseObject({ id: TEXTO }), json).id;
}

export function mapearPreapproval(json: unknown): AssinaturaProvedor {
  const p = parse(ESQUEMA_PREAPPROVAL, json);
  const estado = ESTADO_POR_STATUS[p.status];
  if (estado === undefined || !UUID.test(p.external_reference)) throw erro();
  return {
    id: p.id,
    salaoId: p.external_reference,
    estado,
    valorCentavos: centavos(p.auto_recurring.transaction_amount),
    // D-4 (semântica NÃO CONFIRMADA): os consumidores usam o relógio do evento, não estes campos.
    autorizadaEm: estado === 'autorizada' ? data(p.date_created) : null,
    proximaCobrancaEm: data(p.next_payment_date),
    canceladaEm: estado === 'cancelada' ? data(p.last_modified) : null,
  };
}

/** `next_payment_date` da resposta, ou null. */
export function extrairProximaCobranca(json: unknown): Date | null {
  return mapearPreapproval(json).proximaCobrancaEm;
}

/**
 * Tabela única de `authorized_payments` (enumerações NÃO CONFIRMADAS): `processed` + `payment.status`
 * `approved` aprova; `rejected` (do pagamento), `recycling` e `cancelled` recusam; o resto
 * (`scheduled`, desconhecido) é ErroProvedor e a notificação é reentregue (RN-11).
 */
export function mapearPagamento(json: unknown): PagamentoProvedor {
  const p = parse(ESQUEMA_PAGAMENTO, json);
  const pagamento = p.payment?.status ?? null;
  let status: PagamentoProvedor['status'];
  if (pagamento === 'rejected' || p.status === 'recycling' || p.status === 'cancelled') status = 'recusado';
  else if (p.status === 'processed' && pagamento === 'approved') status = 'aprovado';
  else throw erro();
  const ocorridoEm = data(p.debit_date) ?? data(p.last_modified) ?? data(p.date_created);
  if (ocorridoEm === null) throw erro();
  return {
    id: String(p.id),
    assinaturaId: p.preapproval_id,
    status,
    valorCentavos: centavos(p.transaction_amount),
    ocorridoEm,
  };
}
