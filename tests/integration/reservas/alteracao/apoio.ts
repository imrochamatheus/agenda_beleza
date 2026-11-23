import { vi } from 'vitest';

import { obterPrisma } from '@/server/repos/db';
import { criarReserva } from '@/server/reservas/criar-reserva';
import { criarDecisorDeEncaixe } from '@/server/reservas/decisor-encaixe';
import { criarTenantContext } from '@/server/tenant/context';
import type { TenantContext } from '@/server/tenant/context';

import type { CenarioReserva, DataCivil } from '../../../support/reservas';
import { AGORA, conferirDerivados, criarCenarioReserva, definirJornada, DIA, sp } from '../../../support/reservas';
import { telefoneNovo } from '../../../support/sql';

// Apoio dos testes das operações POR ITEM (D-050 T-6). Independente do apoio da equipe (T-12): as reservas
// nascem por `criarReserva` em modo encaixe com o decisor em lote já confirmado (o modo não importa aqui; só
// os itens gravados). Sem mocks de banco; relógio sempre injetado.

export { AGORA, conferirDerivados, DIA, sp };

export const db = () => obterPrisma();

/** Cenário com Ana (A, B, C), Bia (A, C) com jornada 09:00–19:00 e o serviço C (R$ 40,00, 20 min). */
export type Cenario = CenarioReserva & { C: string };

export async function criarCenario(o: Parameters<typeof criarCenarioReserva>[0] = {}): Promise<Cenario> {
  const c = await criarCenarioReserva(o);
  await definirJornada(c.s.salaoId, c.bia, [['09:00', '19:00']]);
  const salaoId = c.s.salaoId;
  const C = (await db().servico.create({ data: { salaoId, nome: 'C', precoCentavos: 4000, duracaoMin: 20 }, select: { id: true } })).id;
  await db().servicoProfissional.createMany({
    data: [
      { salaoId, servicoId: C, profissionalId: c.ana },
      { salaoId, servicoId: C, profissionalId: c.bia },
    ],
  });
  return { ...c, C };
}

/** Contexto do papel profissional com o perfil dado (o serviço não confere a sessão). */
export function ctxProfissional(c: CenarioReserva, profissionalId = c.ana): TenantContext {
  return criarTenantContext({ usuarioId: c.s.profissional.usuarioId, papel: 'profissional', salaoId: c.s.salaoId, profissionalId });
}

/** Espião de fila que aceita tudo; `chaves` traz as chaves enfileiradas. */
export function filaEspia() {
  const f = vi.fn<(...a: unknown[]) => Promise<{ criado: true; id: string }>>(async () => ({ criado: true, id: 'job' }));
  return {
    enfileirar: f as unknown as NonNullable<Parameters<typeof criarReserva>[2]>['enfileirar'],
    chaves: () => f.mock.calls.map((x) => (x[2] as { chave: string }).chave),
    total: () => f.mock.calls.length,
  };
}

export type ItemNovo = { servicoId?: string; profissionalId?: string; hora: string; data?: DataCivil };

/**
 * Reserva `confirmado` com os itens dados (padrão serviço A com a Ana), na ordem dada, com consentimento de
 * mensagens (e de convite, se pedido) e a confirmação registrada. Devolve o id da reserva e os ids dos
 * itens NA ORDEM PEDIDA.
 */
export async function criarComItens(
  c: Cenario,
  itens: readonly ItemNovo[],
  o: { convite?: boolean; mensagens?: boolean } = {},
): Promise<{ id: string; itens: string[] }> {
  const r = await criarReserva(
    c.ctxEquipe,
    {
      itens: itens.map((i) => ({ servicoId: i.servicoId ?? c.A, profissionalId: i.profissionalId ?? c.ana, inicio: sp(i.data ?? DIA, i.hora) })),
      cliente: { nome: 'Cliente de Teste', telefone: telefoneNovo() },
      aceites: { mensagensReserva: o.mensagens ?? true, conviteAvaliacao: o.convite ?? false },
      modo: 'encaixe',
      agora: AGORA,
    },
    { enfileirar: async () => ({ criado: true as const, id: 'job' }), decidirEncaixe: criarDecisorDeEncaixe(true), consentimentoOpcional: true },
  );
  if (r.resultado !== 'criada') throw new Error(`reserva de apoio não criada: ${r.resultado}`);
  const porServico = new Map(r.reserva.itens.map((i) => [i.servicoId.toLowerCase(), i.id]));
  return { id: r.reserva.id, itens: itens.map((i) => porServico.get((i.servicoId ?? c.A).toLowerCase())!) };
}

/** Compatibilidade (D-030): reserva de UM item (A com a Ana, 10:00). Devolve o id da reserva. */
export async function criarConfirmada(c: Cenario): Promise<string> {
  return (await criarComItens(c, [{ hora: '10:00' }])).id;
}

const ORDEM_TIPO = ['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'];
/** Mensagens da reserva em ordem estável (tipo, revisão), com o item referido. */
export const mensagensDe = async (reservaId: string) =>
  (
    await db().mensagem.findMany({ where: { reservaId }, select: { tipo: true, revisao: true, estado: true, reservaItemId: true } })
  ).sort((a, b) => ORDEM_TIPO.indexOf(a.tipo) - ORDEM_TIPO.indexOf(b.tipo) || a.revisao - b.revisao);

/** Reserva com os itens por (inicio, id). */
export const reservaDe = (id: string) =>
  db().reserva.findUniqueOrThrow({ where: { id }, include: { itens: { orderBy: [{ inicio: 'asc' }, { id: 'asc' }] } } });

export const itemDe = (id: string) => db().reservaItem.findUniqueOrThrow({ where: { id } });

/** Grava status direto no item e nos derivados (cenários de passado, sem passar pelo serviço). */
export async function forcarStatus(reservaId: string, itemId: string, status: 'concluido' | 'nao_compareceu' | 'cancelado'): Promise<void> {
  await db().reservaItem.update({ where: { id: itemId }, data: { status } });
  const itens = await db().reservaItem.findMany({ where: { reservaId } });
  const ordem = ['confirmado', 'concluido', 'nao_compareceu', 'cancelado'] as const;
  const derivado = ordem.find((s) => itens.some((i) => i.status === s))!;
  const ativos = itens.filter((i) => i.status !== 'cancelado');
  const base = ativos.length > 0 ? ativos : itens;
  await db().reserva.update({
    where: { id: reservaId },
    data: {
      status: derivado,
      inicio: new Date(Math.min(...base.map((i) => i.inicio.getTime()))),
      fim: new Date(Math.max(...base.map((i) => i.fim.getTime()))),
      canceladaEm: derivado === 'cancelado' ? AGORA : null,
    },
  });
  await conferirDerivados(reservaId);
}

/** Dá à cliente da reserva o consentimento do convite de avaliação. */
export async function consentirConvite(reservaId: string): Promise<void> {
  const r = await db().reserva.findUniqueOrThrow({ where: { id: reservaId } });
  await db().consentimento.create({
    data: { salaoId: r.salaoId, clienteId: r.clienteId, finalidade: 'convite_avaliacao', origem: 'publico', versaoTermos: 'versao-de-teste' },
  });
}

/** Instante logo depois do fim do dia de teste (para concluir/não compareceu). */
export const DEPOIS = sp(DIA, '20:00');
