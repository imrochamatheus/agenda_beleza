import { randomUUID } from 'node:crypto';

import { obterPrisma } from '@/server/repos/db';
import type { EntradaReservaPublica } from '@/server/reserva-publica/tipos';

import { AGORA, DIA, criarCenarioReserva, sp } from './reservas';
import type { CenarioReserva } from './reservas';
import { telefoneNovo } from './sql';

// Apoio dos testes da página pública (D-026 T-3): parte do cenário de `criarReserva` (D-025), que deixa o
// salão sem jornada nem reserva e com a Ana e a Bia. Relógio sempre injetado.
export { AGORA, DIA, criarCenarioReserva, sp };
export type { CenarioReserva };

/** Enfileirador falso: a fila real não participa (a outbox já é provada na D-024/D-025). */
export const enfileirar = async () => ({ criado: true as const, id: 'job' });

export type EstadoDaAssinatura = 'pendente' | 'em_teste' | 'ativa' | 'em_carencia' | 'suspensa' | 'cancelada' | 'encerrada';

export async function definirAssinatura(salaoId: string, estado: EstadoDaAssinatura, acessoAte: Date | null = null): Promise<void> {
  await obterPrisma().assinatura.create({ data: { salaoId, estado, acessoAte } });
}

/** Entrada válida padrão da página: serviço A com a Ana, terça 10:00 local, aceite do consentimento. */
export function entradaPublica(c: CenarioReserva, sobre: Partial<EntradaReservaPublica> = {}): EntradaReservaPublica {
  return {
    slug: c.s.slugAtual,
    servicoIds: [c.A],
    profissionalId: c.ana,
    inicio: sp(DIA, '10:00').toISOString(),
    nome: 'Maria da Silva',
    telefone: telefoneNovo(),
    aceites: { mensagensReserva: true, conviteAvaliacao: false },
    chaveRequisicao: randomUUID(),
    ...sobre,
  };
}
