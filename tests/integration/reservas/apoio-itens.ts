// Apoio dos testes de criação com N itens (D-050 T-5). Monta itens no formato da §3.5 sobre o cenário de
// `tests/support/reservas.ts` (serviço A padrão e a profissional Ana) e grava a agenda já ocupada (`ocupar`).
import { obterPrisma } from '@/server/repos/db';

import { definirJornada } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { telefoneNovo } from '../../support/sql';

export type ItemDeTeste = { servicoId: string; profissionalId: string; inicio: Date };

/** Um item: serviço A e a Ana, salvo o que for sobrescrito. */
export function item(c: CenarioReserva, inicio: Date, o: { servicoId?: string; profissionalId?: string } = {}): ItemDeTeste {
  return { servicoId: o.servicoId ?? c.A, profissionalId: o.profissionalId ?? c.ana, inicio };
}

/** Sobrescrita de `entradaReserva` com um único item. */
export function um(c: CenarioReserva, inicio: Date, o: { servicoId?: string; profissionalId?: string } = {}): { itens: ItemDeTeste[] } {
  return { itens: [item(c, inicio, o)] };
}

/** Jornada 09:00–19:00 da Bia em todos os dias (no cenário ela começa sem jornada). */
export async function jornadaDaBia(c: CenarioReserva, faixas: [string, string][] = [['09:00', '19:00']]): Promise<void> {
  await definirJornada(c.s.salaoId, c.bia, faixas);
}

/** Desfecho de revalidação recusada para os índices dados (padrão: o item 0). */
export function revalidacao(...itens: number[]) {
  return { resultado: 'horario_indisponivel', causa: 'revalidacao', itens: itens.length > 0 ? itens : [0] } as const;
}

/**
 * Agenda já ocupada: reserva + UM item gravados num único comando (CTE), com cliente própria e derivados
 * coerentes (status do item; envelope = o item; `cancelada_em` só se cancelada). Equivale a
 * `inserirReservaDireta` do suporte, sem o create aninhado do Prisma. Devolve o id da reserva.
 */
export async function ocupar(
  c: CenarioReserva,
  r: {
    inicio: Date;
    fim: Date;
    ocupadoAte?: Date;
    status?: 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
    profissionalId?: string;
    servicoId?: string;
    encaixe?: boolean;
  },
): Promise<string> {
  const duracao = (r.fim.getTime() - r.inicio.getTime()) / 60_000;
  if (!Number.isInteger(duracao) || duracao <= 0) throw new RangeError('ocupar: fim - inicio deve ser inteiro em minutos');
  const status = r.status ?? 'confirmado';
  const linhas = await obterPrisma().$queryRaw<{ id: string }[]>`
    WITH cl AS (
      INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES (${c.s.salaoId}::uuid, 'Cliente da agenda', ${telefoneNovo()})
      RETURNING id
    ), r AS (
      INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem, cancelada_em)
      SELECT ${c.s.salaoId}::uuid, cl.id, ${r.inicio}::timestamptz, ${r.fim}::timestamptz, ${status}::status_reserva, 'equipe',
             CASE WHEN ${status}::status_reserva = 'cancelado' THEN now() END
        FROM cl
      RETURNING id
    )
    INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, inicio, fim, ocupado_ate, status, encaixe,
                              preco_centavos, duracao_min)
    SELECT ${c.s.salaoId}::uuid, r.id, ${r.servicoId ?? c.A}::uuid, ${r.profissionalId ?? c.ana}::uuid, 0, ${r.inicio}::timestamptz,
           ${r.fim}::timestamptz, ${r.ocupadoAte ?? r.fim}::timestamptz, ${status}::status_reserva, ${r.encaixe ?? false}, 5000, ${duracao}::int
      FROM r
    RETURNING reserva_id::text AS id`;
  return linhas[0].id;
}
