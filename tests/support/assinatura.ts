import { obterPrisma } from '@/server/repos/db';
import { contextoDeSistema } from '@/server/tenant/context';

import { slugNovo } from './sql';

// Fábricas da assinatura (D-037): linhas gravadas direto por estado, relógio sempre explícito.

export type EstadoAssinaturaTeste = 'pendente' | 'em_teste' | 'ativa' | 'em_carencia' | 'suspensa' | 'cancelada' | 'encerrada';

export async function criarSalaoSemAssinatura(): Promise<{ salaoId: string; ctx: ReturnType<typeof contextoDeSistema> }> {
  const salao = await obterPrisma().salao.create({ data: { nome: `Salão ${slugNovo()}` }, select: { id: true } });
  return { salaoId: salao.id, ctx: contextoDeSistema(salao.id, 'teste') };
}

export type CamposTeste = {
  testeFimEm?: Date | null;
  periodoPagoAte?: Date | null;
  primeiraFalhaEm?: Date | null;
  carenciaAte?: Date | null;
  canceladaEm?: Date | null;
  acessoAte?: Date | null;
  criadoEm?: Date;
};

export async function criarAssinaturaEm(salaoId: string, estado: EstadoAssinaturaTeste, campos: CamposTeste = {}): Promise<string> {
  const a = await obterPrisma().assinatura.create({
    data: { salaoId, estado, atualizadoEm: new Date('2020-01-01T00:00:00Z'), ...campos },
    select: { id: true },
  });
  return a.id;
}

/** Salão novo já com uma assinatura no estado dado. */
export async function criarSalaoComAssinatura(estado: EstadoAssinaturaTeste, campos: CamposTeste = {}) {
  const s = await criarSalaoSemAssinatura();
  const assinaturaId = await criarAssinaturaEm(s.salaoId, estado, campos);
  return { ...s, assinaturaId };
}

export const lerAssinatura = (id: string) => obterPrisma().assinatura.findUniqueOrThrow({ where: { id } });
export const pagamentosDe = (assinaturaId: string) =>
  obterPrisma().assinaturaPagamento.findMany({ where: { assinaturaId }, orderBy: { criadoEm: 'asc' } });
export const transicoesDe = (assinaturaId: string) =>
  obterPrisma().assinaturaTransicao.findMany({ where: { assinaturaId }, orderBy: [{ ocorridaEm: 'asc' }, { id: 'asc' }] });

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
