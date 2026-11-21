import { criarTenantContext } from '@/server/tenant/context';
import type { TenantContext } from '@/server/tenant/context';
import type { EntradaReservaEquipe } from '@/server/reservas/tipos';

import { telefoneNovo } from '../../../support/sql';
import type { CenarioReserva } from '../../../support/reservas';
import { AGORA } from '../../../support/reservas';

export { AGORA };

/** Contexto da profissional Ana (papel profissional, perfil ligado). */
export function ctxProfissional(c: CenarioReserva, profissionalId = c.ana): TenantContext {
  return criarTenantContext({ usuarioId: c.s.profissional.usuarioId, papel: 'profissional', salaoId: c.s.salaoId, profissionalId });
}

/** Formulário válido padrão (serviço A com a Ana, terça 2026-12-01 10:00 local, mensagens aceitas). */
export function entradaEquipe(c: CenarioReserva, sobre: Partial<EntradaReservaEquipe> = {}): EntradaReservaEquipe {
  return {
    servicoIds: [c.A],
    profissionalId: c.ana,
    data: '2026-12-01',
    hora: '10:00',
    nome: 'Cliente de Balcão',
    telefone: telefoneNovo(),
    aceites: { mensagensReserva: true },
    confirmarEncaixe: undefined,
    chaveRequisicao: null,
    ...sobre,
  };
}

export const enfileirar = async () => ({ criado: true as const, id: 'job' });
