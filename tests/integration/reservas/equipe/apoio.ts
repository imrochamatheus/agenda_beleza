import { obterPrisma } from '@/server/repos/db';
import { criarTenantContext } from '@/server/tenant/context';
import type { TenantContext } from '@/server/tenant/context';
import type { EntradaReservaEquipe } from '@/server/reservas/tipos';

import { definirJornada } from '../../../support/reservas';
import type { CenarioReserva } from '../../../support/reservas';
import { AGORA } from '../../../support/reservas';
import { telefoneNovo } from '../../../support/sql';

export { AGORA };

/** Contexto da profissional Ana (papel profissional, perfil ligado). */
export function ctxProfissional(c: CenarioReserva, profissionalId = c.ana): TenantContext {
  return criarTenantContext({ usuarioId: c.s.profissional.usuarioId, papel: 'profissional', salaoId: c.s.salaoId, profissionalId });
}

export type LinhaDeTeste = { servicoId: string; profissionalId: string; hora: string };

/** Uma linha do formulário (D-050 §3.11): serviço, profissional e hora local "HH:MM". */
export const linha = (servicoId: string, profissionalId: string, hora: string): LinhaDeTeste => ({ servicoId, profissionalId, hora });

/** Formulário válido padrão (uma linha: serviço A com a Ana às 10:00, terça 2026-12-01, mensagens aceitas). */
export function entradaEquipe(c: CenarioReserva, sobre: Partial<EntradaReservaEquipe> = {}): EntradaReservaEquipe {
  return {
    data: '2026-12-01',
    itens: [linha(c.A, c.ana, '10:00')],
    nome: 'Cliente de Balcão',
    telefone: telefoneNovo(),
    aceites: { mensagensReserva: true },
    confirmarEncaixe: undefined,
    chaveRequisicao: null,
    ...sobre,
  };
}

/** Atalho do caso de uma linha: serviço A com a Ana na hora dada. */
export const umaLinha = (c: CenarioReserva, hora: string, o: { servicoId?: string; profissionalId?: string } = {}) => ({
  itens: [linha(o.servicoId ?? c.A, o.profissionalId ?? c.ana, hora)],
});

/**
 * Terceiro serviço C (R$ 30,00, 20 min) e terceira profissional Carla (só C), além da jornada 09:00–19:00 da
 * Bia e da Carla: o cenário de 3 itens em 3 profissionais (CA-23).
 */
export async function comTresProfissionais(c: CenarioReserva): Promise<{ C: string; carla: string }> {
  const db = obterPrisma();
  const salaoId = c.s.salaoId;
  const C = (await db.servico.create({ data: { salaoId, nome: 'C', precoCentavos: 3000, duracaoMin: 20 }, select: { id: true } })).id;
  const carla = (await db.profissional.create({ data: { salaoId, nome: 'Carla' }, select: { id: true } })).id;
  await db.servicoProfissional.create({ data: { salaoId, servicoId: C, profissionalId: carla } });
  await definirJornada(salaoId, c.bia, [['09:00', '19:00']]);
  await definirJornada(salaoId, carla, [['09:00', '19:00']]);
  return { C, carla };
}

/** Itens gravados do salão, por (inicio, id), com o que os testes conferem. */
export async function itensGravados(salaoId: string) {
  return obterPrisma().reservaItem.findMany({
    where: { salaoId },
    orderBy: [{ inicio: 'asc' }, { id: 'asc' }],
    select: { reservaId: true, servicoId: true, profissionalId: true, ordem: true, inicio: true, fim: true, encaixe: true, status: true },
  });
}

export const enfileirar = async () => ({ criado: true as const, id: 'job' });
