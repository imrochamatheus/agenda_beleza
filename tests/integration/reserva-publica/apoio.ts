import { obterPrisma } from '@/server/repos/db';
import { valorDoItem } from '@/server/reserva-publica/passos';

import { criarCenarioReserva, definirJornada } from '../../support/reservas';
import type { CenarioReserva, OpcoesCenarioReserva } from '../../support/reservas';

// D-050 T-10: cenário do exemplo (3 serviços, 3 profissionais). Parte do cenário da D-025 (A: Ana e Bia;
// B: Ana) e acrescenta: B também com a Bia, o serviço C (R$ 40,00, 45 min) só com a Carla, e jornada
// 09:00–19:00 para Bia e Carla (Ana: a do cenário).

export type CenarioTres = CenarioReserva & { C: string; carla: string };

export async function criarCenarioTres(o: OpcoesCenarioReserva = {}): Promise<CenarioTres> {
  const c = await criarCenarioReserva(o);
  const db = obterPrisma();
  const salaoId = c.s.salaoId;
  const carla = (await db.profissional.create({ data: { salaoId, nome: 'Carla' }, select: { id: true } })).id;
  const C = (await db.servico.create({ data: { salaoId, nome: 'C', precoCentavos: 4000, duracaoMin: 45 }, select: { id: true } })).id;
  await db.servicoProfissional.createMany({
    data: [
      { salaoId, servicoId: c.B, profissionalId: c.bia },
      { salaoId, servicoId: C, profissionalId: carla },
    ],
  });
  await definirJornada(salaoId, c.bia, [['09:00', '19:00']]);
  await definirJornada(salaoId, carla, [['09:00', '19:00']]);
  return { ...c, C, carla };
}

/** Valor do item (`h<k>`/rádio) a partir de profissional e instante. */
export const h = (profissionalId: string, inicio: Date): string => valorDoItem(profissionalId, inicio);
