import { integracoes } from '@/server/integrations/registry';
import { RecursoNaoEncontradoNoProvedor } from '@/server/integrations/mercadopago/port';
import type { AssinaturaProvedor, PagamentoProvedor, PortaMercadoPago } from '@/server/integrations/mercadopago/port';
import { repoAssinaturaSistema } from '@/server/repos/assinatura';
import { incrementarJanela } from '@/server/repos/rate-limit';
import { repoWebhookSistema } from '@/server/repos/webhook';
import type { ResultadoFinal } from '@/server/repos/webhook';
import { contextoDeSistema } from '@/server/tenant/context';

import { processarAutorizada } from './retorno';
import { aplicarEventoAssinatura } from './servico';
import type { ResultadoAssinatura } from './tipos';
import {
  chaveDoCorpo,
  extrairChave,
  LIMITE_INVALIDOS_POR_MINUTO,
  mapearConsultado,
  reconhecerRecurso,
  sanitizarPayload,
} from './webhook-decisao';
import type { CodigoErroWebhook } from './webhook-decisao';

// Recebimento do webhook do MP (D-041). Ordem: validar origem → persistir `webhook_evento` → consultar
// o provedor FORA de transação → aplicar o efeito só por `aplicarEventoAssinatura` (com `eventoId`).
// O webhook é do sistema: nunca consulta a política de operação (D-038). Síncrono (RN-8).

export type EntradaWebhook = {
  cabecalhos: Record<string, string>;
  consulta: Record<string, string>;
  /** `null` = corpo acima do limite (nunca lido inteiro). */
  corpoBruto: string | null;
  jsonInvalido?: boolean;
  /** JSON já parseado (indefinido quando inválido). */
  corpo?: unknown;
};

export type RespostaWebhook =
  | { status: 200; corpo: { ok: true } }
  | { status: 401 | 400 | 413 | 503; corpo: { erro: 'nao_autorizado' | 'invalido' | 'indisponivel' }; retryAfter?: number };

export type DepsWebhook = {
  mp?: PortaMercadoPago;
  log?: (evento: string, campos: Record<string, unknown>) => void;
  limiteInvalidos?: number;
};

const JANELA_INVALIDOS_MS = 60_000;
const CHAVE_INVALIDOS = 'webhook-mp-invalidos';
const LEASE_MS = 2 * 60 * 1000;
export const RETRY_AFTER_SEGUNDOS = 60;

const OK: RespostaWebhook = { status: 200, corpo: { ok: true } };
const NAO_AUTORIZADO: RespostaWebhook = { status: 401, corpo: { erro: 'nao_autorizado' } };
const indisponivel = (): RespostaWebhook => ({ status: 503, corpo: { erro: 'indisponivel' }, retryAfter: RETRY_AFTER_SEGUNDOS });

const logPadrao = (evento: string, campos: Record<string, unknown>) =>
  console.warn(JSON.stringify({ evento, ...campos }));

type Desfecho = { resultado: ResultadoFinal; erro?: CodigoErroWebhook | string; salaoId?: string };

async function registrarInvalido(
  e: EntradaWebhook,
  agora: Date,
  deps: DepsWebhook,
  resposta: RespostaWebhook,
  tipo: string | null,
): Promise<RespostaWebhook> {
  const log = deps.log ?? logPadrao;
  const inicio = new Date(Math.floor(agora.getTime() / JANELA_INVALIDOS_MS) * JANELA_INVALIDOS_MS);
  const contador = await incrementarJanela(CHAVE_INVALIDOS, inicio);
  if (contador > (deps.limiteInvalidos ?? LIMITE_INVALIDOS_POR_MINUTO)) {
    log('webhook.invalidos_acima_do_limite', { contador });
    return NAO_AUTORIZADO;
  }
  const chave = extrairChave(e.cabecalhos) ?? chaveDoCorpo(e.corpoBruto, e.cabecalhos['x-request-id'] ?? null);
  const payload = e.corpoBruto !== null && e.jsonInvalido !== true ? sanitizarPayload(e.corpo) : {};
  await repoWebhookSistema().registrar({
    chaveDedupe: chave,
    tipo,
    recursoId: null,
    payload,
    origemValida: false,
    agora,
  });
  return resposta;
}

function tipoDe(e: EntradaWebhook): string | null {
  const t = sanitizarPayload(e.corpo).type;
  return typeof t === 'string' ? t : null;
}

export async function receberWebhook(e: EntradaWebhook, agora: Date, deps: DepsWebhook = {}): Promise<RespostaWebhook> {
  const log = deps.log ?? logPadrao;
  if (e.corpoBruto === null) {
    return registrarInvalido(e, agora, deps, { status: 413, corpo: { erro: 'invalido' } }, null);
  }
  if (e.jsonInvalido === true) {
    return registrarInvalido(e, agora, deps, { status: 400, corpo: { erro: 'invalido' } }, null);
  }
  const mp = deps.mp ?? integracoes().mercadoPago;
  const validacao = await mp.validarWebhook({
    cabecalhos: e.cabecalhos,
    consulta: e.consulta,
    corpo: e.corpo,
    corpoBruto: e.corpoBruto,
  });
  const chave = extrairChave(e.cabecalhos);
  if (!validacao.valida || chave === null) {
    return registrarInvalido(e, agora, deps, NAO_AUTORIZADO, tipoDe(e));
  }

  const eventos = repoWebhookSistema();
  const reg = await eventos.registrar({
    chaveDedupe: chave,
    tipo: validacao.tipo,
    recursoId: reconhecerRecurso(validacao.recursoId),
    payload: sanitizarPayload(e.corpo),
    origemValida: true,
    agora,
  });
  if (!reg.criada) {
    if (reg.resultado !== 'erro' && reg.resultado !== 'recebido') return OK;
    if (reg.resultado === 'recebido' && agora.getTime() - reg.recebidoEm.getTime() < LEASE_MS) return OK;
    if (!(await eventos.reivindicar(reg.id, agora))) return OK;
  }

  let desfecho: Desfecho;
  try {
    desfecho = await processar(reg.id, validacao.tipo, validacao.recursoId, agora, mp, log);
  } catch {
    desfecho = { resultado: 'erro', erro: 'interno' };
  }
  try {
    await eventos.concluir(reg.id, {
      resultado: desfecho.resultado,
      agora,
      ...(desfecho.erro !== undefined ? { erro: desfecho.erro } : {}),
      ...(desfecho.salaoId !== undefined ? { salaoId: desfecho.salaoId } : {}),
    });
  } catch {
    log('webhook.conclusao_falhou', { eventoId: reg.id });
    return indisponivel();
  }
  return desfecho.resultado === 'erro' ? indisponivel() : OK;
}

async function processar(
  eventoId: string,
  tipo: 'assinatura' | 'pagamento',
  recursoId: string,
  agora: Date,
  mp: PortaMercadoPago,
  log: NonNullable<DepsWebhook['log']>,
): Promise<Desfecho> {
  // Consulta ao provedor FORA de qualquer transação (D-040 RN-4).
  let pagamento: PagamentoProvedor | null = null;
  let assinaturaProv: AssinaturaProvedor | null = null;
  try {
    if (tipo === 'pagamento') pagamento = await mp.consultarPagamento(recursoId);
    else assinaturaProv = await mp.consultarAssinatura(recursoId);
  } catch (err) {
    if (err instanceof RecursoNaoEncontradoNoProvedor) return { resultado: 'ignorado', erro: 'recurso_inexistente' };
    log('webhook.provedor_indisponivel', { eventoId });
    return { resultado: 'erro', erro: 'provedor_indisponivel' };
  }

  const provedorId = pagamento !== null ? pagamento.assinaturaId : recursoId;
  const local = await repoAssinaturaSistema().buscarPorProvedor(provedorId);
  if (local === null) return { resultado: 'ignorado', erro: 'assinatura_desconhecida' };
  if (assinaturaProv !== null && assinaturaProv.salaoId !== local.salaoId) {
    log('webhook.vinculo_invalido', { eventoId, assinaturaId: local.id });
    return { resultado: 'ignorado', erro: 'vinculo_invalido', salaoId: local.salaoId };
  }
  await repoWebhookSistema().vincularSalao(eventoId, local.salaoId);

  const consultado = pagamento !== null
    ? mapearConsultado({ tipo: 'pagamento', p: pagamento })
    : mapearConsultado({ tipo: 'assinatura', p: assinaturaProv as AssinaturaProvedor });
  const base = { salaoId: local.salaoId };
  if (consultado.acao === 'ignorar') return { resultado: 'ignorado', erro: consultado.codigo, ...base };

  const ctx = contextoDeSistema(local.salaoId, 'webhook-mp');
  if (consultado.acao === 'autorizada') {
    const r = await processarAutorizada(ctx, { id: local.id }, assinaturaProv as AssinaturaProvedor, agora, { log, eventoId });
    return r === 'neutro' ? { resultado: 'ignorado', erro: 'ignorado_pela_maquina', ...base } : { resultado: 'processado', ...base };
  }
  const r: ResultadoAssinatura = await aplicarEventoAssinatura(ctx, consultado.evento, agora, {
    assinaturaId: local.id,
    eventoId,
    log,
  });
  switch (r.resultado) {
    case 'aplicado':
      return { resultado: 'processado', ...base };
    case 'sem_efeito':
      return { resultado: 'processado', ...(r.motivo ? { erro: r.motivo } : {}), ...base };
    case 'ignorado':
      return { resultado: 'ignorado', erro: r.motivo, ...base };
    case 'sem_assinatura':
      return { resultado: 'ignorado', erro: 'sem_assinatura', ...base };
    case 'ocupada':
      return { resultado: 'erro', erro: 'ocupada', ...base };
  }
}
