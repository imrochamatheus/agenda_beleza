import { randomUUID } from 'node:crypto';

import { criarMercadoPagoSimulado } from '@/server/integrations/mercadopago/simulado';
import { obterPrisma } from '@/server/repos/db';
import { criarTenantContext } from '@/server/tenant/context';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';

// Apoio da D-040: salão com gestor real (e-mail da sessão), MP simulado e leitura do simulado por salão.

export const APP_URL = 'http://localhost:3000';
export const mp = criarMercadoPagoSimulado({ appUrl: APP_URL });

export type SalaoD40 = { s: SalaoCompleto; salaoId: string; ctx: ReturnType<typeof criarTenantContext> };

export async function criarSalaoD40(): Promise<SalaoD40> {
  const s = await criarSalaoCompleto();
  const ctx = criarTenantContext({ usuarioId: s.gestor.usuarioId, papel: 'gestor', salaoId: s.salaoId, profissionalId: s.gestor.profissionalId });
  return { s, salaoId: s.salaoId, ctx };
}

export const vigenteDe = (salaoId: string) => obterPrisma().assinatura.findMany({ where: { salaoId, NOT: { estado: 'encerrada' } } });
export const simDoSalao = (salaoId: string) =>
  obterPrisma().simMpAssinatura.findMany({ where: { referenciaExterna: salaoId }, orderBy: { criadoEm: 'asc' } });
export const transicoes = (assinaturaId: string) => obterPrisma().assinaturaTransicao.findMany({ where: { assinaturaId } });
export const idInexistente = () => randomUUID();
