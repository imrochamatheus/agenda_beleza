import { randomUUID } from 'node:crypto';

import type { NotificacaoWebhook, PortaMercadoPago } from '@/server/integrations/mercadopago/port';
import { tratarWebhook } from '@/server/assinatura/webhook-http';
import { obterPrisma } from '@/server/repos/db';

import { criarSalaoComAssinatura } from '../../support/assinatura';
import type { CamposTeste, EstadoAssinaturaTeste } from '../../support/assinatura';
import { APP_URL, mp } from './apoio-iniciar';

// Apoio da D-041: salão com assinatura local vinculada a uma assinatura do MP simulado, notificações
// montadas como o MP as enviaria e um espião da porta (contagem de consultas).

export { mp };
export const AGORA = new Date('2027-05-10T12:00:00Z');

/** Salão com assinatura local em `estado`, vinculada a uma assinatura do simulado (autorizada se `estado` ≠ pendente). */
export async function salaoComMp(estado: EstadoAssinaturaTeste, campos: CamposTeste = {}) {
  const s = await criarSalaoComAssinatura(estado, campos);
  const { assinaturaId: simId } = await mp.criarAssinatura({
    salaoId: s.salaoId,
    emailPagador: 'pagador@exemplo.com.br',
    urlRetorno: `${APP_URL}/painel/assinatura`,
  });
  if (estado !== 'pendente') await mp.autorizar(simId, { em: AGORA });
  await obterPrisma().assinatura.update({ where: { id: s.assinaturaId }, data: { provedorAssinaturaId: simId } });
  return { ...s, simId };
}

export function pedido(n: NotificacaoWebhook, opcoes: { corpo?: string; cabecalhos?: Record<string, string> } = {}): Request {
  const consulta = new URLSearchParams(n.consulta as Record<string, string>).toString();
  return new Request(`http://localhost:3000/api/webhooks/mercadopago?${consulta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...n.cabecalhos, ...opcoes.cabecalhos },
    body: opcoes.corpo ?? JSON.stringify(n.corpo),
  });
}

export type Espiao = PortaMercadoPago & { chamadas: string[] };

export function espiar(porta: PortaMercadoPago = mp): Espiao {
  const chamadas: string[] = [];
  return {
    chamadas,
    criarAssinatura: (e) => porta.criarAssinatura(e),
    consultarAssinatura: (id) => (chamadas.push('consultarAssinatura'), porta.consultarAssinatura(id)),
    consultarPagamento: (id) => (chamadas.push('consultarPagamento'), porta.consultarPagamento(id)),
    cancelarAssinatura: (id) => porta.cancelarAssinatura(id),
    adiarProximaCobranca: (id, d) => porta.adiarProximaCobranca(id, d),
    validarWebhook: (n) => porta.validarWebhook(n),
  };
}

export async function enviar(
  n: NotificacaoWebhook,
  o: { mp?: PortaMercadoPago; agora?: Date; corpo?: string; cabecalhos?: Record<string, string>; limiteInvalidos?: number } = {},
): Promise<Response> {
  return tratarWebhook(pedido(n, { ...(o.corpo !== undefined ? { corpo: o.corpo } : {}), ...(o.cabecalhos ? { cabecalhos: o.cabecalhos } : {}) }), {
    mp: o.mp ?? mp,
    agora: o.agora ?? AGORA,
    log: () => undefined,
    ...(o.limiteInvalidos !== undefined ? { limiteInvalidos: o.limiteInvalidos } : {}),
  });
}

/** Assinatura adulterada: a origem não confere. */
export function adulterada(n: NotificacaoWebhook): NotificacaoWebhook {
  const v1 = '0'.repeat(64);
  return { ...n, cabecalhos: { ...n.cabecalhos, 'x-signature': `ts=${Date.now()},v1=${v1}` } };
}

export const eventosDoSalao = (salaoId: string) =>
  obterPrisma().webhookEvento.findMany({ where: { salaoId }, orderBy: { recebidoEm: 'asc' } });
export const eventoPorChave = (chave: string) =>
  obterPrisma().webhookEvento.findMany({ where: { chaveDedupe: chave }, orderBy: { recebidoEm: 'asc' } });
export const novaChave = () => `req-${randomUUID()}`;
