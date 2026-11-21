import { vi } from 'vitest';

import { criarReservaDaEquipe } from '@/server/reservas/reserva-equipe';
import { obterPrisma } from '@/server/repos/db';

import type { CenarioReserva } from '../../../support/reservas';
import { criarCenarioReserva, definirJornada, DIA, sp } from '../../../support/reservas';
import { AGORA, ctxProfissional, enfileirar, entradaEquipe } from '../equipe/apoio';

export { AGORA, ctxProfissional, DIA, sp };

export const db = () => obterPrisma();

/** Espião de fila que aceita tudo; `chamadas` traz as chaves enfileiradas. */
export function filaEspia() {
  const f = vi.fn<(...a: unknown[]) => Promise<{ criado: true; id: string }>>(async () => ({ criado: true, id: 'job' }));
  return {
    enfileirar: f as unknown as typeof enfileirar,
    chaves: () => f.mock.calls.map((c) => (c[2] as { chave: string }).chave),
    total: () => f.mock.calls.length,
  };
}

/** Reserva `confirmado` criada pelo serviço (com consentimento de mensagens e a confirmação pendente). */
export async function criarConfirmada(
  c: CenarioReserva,
  sobre: Parameters<typeof entradaEquipe>[1] = {},
): Promise<string> {
  const r = await criarReservaDaEquipe(c.ctxEquipe, entradaEquipe(c, sobre), AGORA, { enfileirar });
  if (r.resultado !== 'criada') throw new Error(`reserva de apoio não criada: ${r.resultado}`);
  return r.reserva.id;
}

const ORDEM_TIPO = ['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'];
/** Mensagens da reserva em ordem estável (tipo, revisão): `criado_em` é o mesmo dentro da transação. */
export const mensagensDe = async (reservaId: string) =>
  (await db().mensagem.findMany({ where: { reservaId }, select: { tipo: true, revisao: true, estado: true } })).sort(
    (a, b) => ORDEM_TIPO.indexOf(a.tipo) - ORDEM_TIPO.indexOf(b.tipo) || a.revisao - b.revisao,
  );

/** Cenário padrão com a Bia também com jornada (09:00–19:00), para remarcar sem encaixe. */
export async function criarCenario(o: Parameters<typeof criarCenarioReserva>[0] = {}): Promise<CenarioReserva> {
  const c = await criarCenarioReserva(o);
  await definirJornada(c.s.salaoId, c.bia, [['09:00', '19:00']]);
  return c;
}

export const reservaDe = (id: string) => db().reserva.findUniqueOrThrow({ where: { id }, include: { itens: { orderBy: { ordem: 'asc' } } } });

/** Dá à cliente da reserva o consentimento do convite de avaliação. */
export async function consentirConvite(reservaId: string): Promise<void> {
  const r = await db().reserva.findUniqueOrThrow({ where: { id: reservaId } });
  await db().consentimento.create({
    data: { salaoId: r.salaoId, clienteId: r.clienteId, finalidade: 'convite_avaliacao', origem: 'publico', versaoTermos: 'versao-de-teste' },
  });
}
