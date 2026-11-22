import { obterPrisma } from '@/server/repos/db';
import type { PortaMercadoPago } from '@/server/integrations/mercadopago/port';

import { criarAssinaturaEm } from '../../support/assinatura';
import type { CamposTeste, EstadoAssinaturaTeste } from '../../support/assinatura';
import { APP_URL, criarSalaoD40, mp } from './apoio-iniciar';

// Apoio da D-042: salão com gestor (contexto de tenant), assinatura local em `estado` vinculada a uma
// assinatura do MP simulado (autorizada, salvo `pendente`/`semVinculo`) e um espião da porta.

export { APP_URL, mp };
export const AGORA = new Date('2027-05-10T12:00:00Z');
export const D = (s: string) => new Date(s);

/** Assinatura local em `estado` para um salão existente, vinculada a uma assinatura do simulado. */
export async function assinaturaVinculada(salaoId: string, estado: EstadoAssinaturaTeste, campos: CamposTeste = {}, emailPagador = 'pagador@exemplo.com.br') {
  const assinaturaId = await criarAssinaturaEm(salaoId, estado, campos);
  const c = await mp.criarAssinatura({ salaoId, emailPagador, urlRetorno: `${APP_URL}/painel/assinatura/retorno` });
  if (estado !== 'pendente') await mp.autorizar(c.assinaturaId, { em: AGORA });
  await obterPrisma().assinatura.update({ where: { id: assinaturaId }, data: { provedorAssinaturaId: c.assinaturaId } });
  return { assinaturaId, simId: c.assinaturaId };
}

export async function salaoGestor(estado: EstadoAssinaturaTeste, campos: CamposTeste = {}, o: { semVinculo?: boolean } = {}) {
  const s = await criarSalaoD40();
  if (o.semVinculo) {
    return { ...s, assinaturaId: await criarAssinaturaEm(s.salaoId, estado, campos), simId: null as string | null };
  }
  const v = await assinaturaVinculada(s.salaoId, estado, campos, s.s.gestor.email);
  return { ...s, ...v, simId: v.simId as string | null };
}

export type EspiaoCancelar = PortaMercadoPago & { chamadas: string[] };

/** Porta que registra o nome de cada chamada; o `antes` roda antes de delegar (ex.: conferir transações abertas). */
export function espiar(antes?: (op: string) => Promise<void>, porta: PortaMercadoPago = mp): EspiaoCancelar {
  const chamadas: string[] = [];
  const reg = async (op: string) => {
    chamadas.push(op);
    await antes?.(op);
  };
  return {
    chamadas,
    criarAssinatura: async (e) => (await reg('criarAssinatura'), porta.criarAssinatura(e)),
    consultarAssinatura: async (id) => (await reg('consultarAssinatura'), porta.consultarAssinatura(id)),
    consultarPagamento: async (id) => (await reg('consultarPagamento'), porta.consultarPagamento(id)),
    cancelarAssinatura: async (id) => (await reg('cancelarAssinatura'), porta.cancelarAssinatura(id)),
    adiarProximaCobranca: async (id, d) => (await reg('adiarProximaCobranca'), porta.adiarProximaCobranca(id, d)),
    urlAtualizarMeioPagamento: async (id) => (await reg('urlAtualizarMeioPagamento'), porta.urlAtualizarMeioPagamento(id)),
    validarWebhook: (n) => porta.validarWebhook(n),
  };
}

export const nuncaChamada: PortaMercadoPago = new Proxy({} as PortaMercadoPago, {
  get(_t, p) {
    throw new Error(`a porta não deveria ser chamada: ${String(p)}`);
  },
});
