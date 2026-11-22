import { createHash } from 'node:crypto';

import type { AssinaturaProvedor, PagamentoProvedor } from '@/server/integrations/mercadopago/port';

import type { EventoAssinatura } from './tipos';

// Decisão pura do webhook do MP (D-041 §2): sem I/O, sem relógio, sem next/*. Chave de dedupe,
// sanitização do payload, reconhecimento do recurso e mapeamento do estado CONSULTADO em efeito.

/** Limite do corpo aceito (RN-9). */
export const LIMITE_CORPO_BYTES = 16 * 1024;
/** Invalidos por janela fixa de 1 min, globais (RN-9). */
export const LIMITE_INVALIDOS_POR_MINUTO = 120;

const TAMANHO_MAX_CHAVE = 128;
const TAMANHO_MAX_TEXTO = 200;
const REDIGIDO = '[redigido]';

/** `x-request-id`: aparado, 1 a 128 caracteres ASCII visíveis. Qualquer outra coisa = sem chave. */
export function extrairChave(cabecalhos: Readonly<Record<string, string>>): string | null {
  const bruto = cabecalhos['x-request-id'];
  if (typeof bruto !== 'string') return null;
  const v = bruto.trim();
  if (v.length < 1 || v.length > TAMANHO_MAX_CHAVE || !/^[\x21-\x7e]+$/.test(v)) return null;
  return v;
}

/** Chave de um evento inválido sem `x-request-id` utilizável: SHA-256 do corpo (inválido não deduplica). */
export function chaveDoCorpo(corpoBruto: string | null, cabecalho: string | null): string {
  return createHash('sha256').update(corpoBruto ?? '', 'utf8').update('\0').update(cabecalho ?? '', 'utf8').digest('hex');
}

/** Qualquer sequência de 13 ou mais dígitos vira `[redigido]` (D-040 CA-4: nunca um número de cartão). */
export function redigirDigitos(texto: string): string {
  return texto.replace(/\d{13,}/g, REDIGIDO);
}

function escalar(v: unknown): string | number | boolean | undefined {
  if (typeof v === 'string') return redigirDigitos(v).slice(0, TAMANHO_MAX_TEXTO);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    return /\d{13,}/.test(String(v)) ? REDIGIDO : v;
  }
  return undefined;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Lista branca: `id`, `type`, `action`, `live_mode`, `data.id`, `date_created` (só escalares). */
export function sanitizarPayload(corpo: unknown): Record<string, unknown> {
  const o = objeto(corpo);
  const saida: Record<string, unknown> = {};
  if (!o) return saida;
  for (const campo of ['id', 'type', 'action', 'live_mode', 'date_created'] as const) {
    if (!Object.hasOwn(o, campo)) continue;
    const v = escalar(o[campo]);
    if (v !== undefined) saida[campo] = v;
  }
  const dados = objeto(Object.hasOwn(o, 'data') ? o.data : undefined);
  if (dados && Object.hasOwn(dados, 'id')) {
    const v = escalar(dados.id);
    if (v !== undefined) saida.data = { id: v };
  }
  return saida;
}

/** `recurso_id` só se for um identificador simples e sem sequência de 13+ dígitos. */
export function reconhecerRecurso(id: unknown): string | null {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || /\d{13,}/.test(id)) return null;
  return id;
}

export type CodigoErroWebhook =
  | 'assinatura_desconhecida'
  | 'recurso_inexistente'
  | 'vinculo_invalido'
  | 'estado_pendente'
  | 'provedor_indisponivel'
  | 'ocupada'
  | 'interno'
  | 'pagamento_duplicado'
  | 'sem_assinatura'
  | 'ignorado_pela_maquina';

export type EfeitoConsultado =
  | { acao: 'evento'; evento: EventoAssinatura }
  | { acao: 'autorizada' }
  | { acao: 'ignorar'; codigo: CodigoErroWebhook };

/** O estado consultado no provedor vence o payload (CA-3). */
export function mapearConsultado(
  c: { tipo: 'pagamento'; p: PagamentoProvedor } | { tipo: 'assinatura'; p: AssinaturaProvedor },
): EfeitoConsultado {
  if (c.tipo === 'pagamento') {
    const { p } = c;
    return p.status === 'aprovado'
      ? { acao: 'evento', evento: { tipo: 'cobranca_aprovada', pagamentoId: p.id, valorCentavos: p.valorCentavos, pagoEm: p.ocorridoEm } }
      : { acao: 'evento', evento: { tipo: 'cobranca_falhou', pagamentoId: p.id, valorCentavos: p.valorCentavos, falhouEm: p.ocorridoEm } };
  }
  if (c.p.estado === 'autorizada') return { acao: 'autorizada' };
  if (c.p.estado === 'cancelada') return { acao: 'evento', evento: { tipo: 'cancelamento' } };
  return { acao: 'ignorar', codigo: 'estado_pendente' };
}
