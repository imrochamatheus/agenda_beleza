import { randomUUID } from 'node:crypto';

import { TOKEN_TURNSTILE_SIMULADO } from '@/server/integrations/turnstile/port';
import { obterPrisma } from '@/server/repos/db';
import type { EntradaReservaPublica } from '@/server/reserva-publica/tipos';

import { AGORA, DIA, criarCenarioReserva, sp } from './reservas';
import type { CenarioReserva } from './reservas';
import { telefoneNovo } from './sql';

// Apoio dos testes da página pública (D-026 T-3; D-050: itens por serviço): parte do cenário de `criarReserva` (D-025), que deixa o
// salão sem jornada nem reserva e com a Ana e a Bia. Relógio sempre injetado.
export { AGORA, DIA, criarCenarioReserva, sp };
export type { CenarioReserva };

/** Enfileirador falso: a fila real não participa (a outbox já é provada na D-024/D-025). */
export const enfileirar = async () => ({ criado: true as const, id: 'job' });

export type EstadoDaAssinatura = 'pendente' | 'em_teste' | 'ativa' | 'em_carencia' | 'suspensa' | 'cancelada' | 'encerrada';

export async function definirAssinatura(salaoId: string, estado: EstadoDaAssinatura, acessoAte: Date | null = null): Promise<void> {
  await obterPrisma().assinatura.create({ data: { salaoId, estado, acessoAte } });
}

let contadorDeIp = 0;
/** IP de documentação distinto a cada chamada (sem colisão dentro do processo). */
export function ipNovo(): string {
  contadorDeIp += 1;
  return `198.51.${Math.floor(contadorDeIp / 250) % 250}.${(contadorDeIp % 250) + 1}`;
}

/** Atalhos de um item só (o caso mais comum dos testes de proteção): serviço A por padrão. */
export type SobreEntradaPublica = Partial<EntradaReservaPublica> & { profissionalId?: string; inicio?: string };

/** Item da página: o mesmo formato que a casca monta a partir de `s` e `h<k>`. */
export const itemPublico = (servicoId: string, profissionalId: string, inicio: Date | string) => ({
  servicoId,
  profissionalId,
  inicio: typeof inicio === 'string' ? inicio : inicio.toISOString(),
});

/**
 * Entrada válida padrão da página: serviço A com a Ana, terça 10:00 local, aceite do consentimento. Sem
 * `itens`, monta UM item com `servicoIds[0]` (padrão A), `profissionalId` (padrão Ana) e `inicio` (padrão
 * 10:00); com `itens`, `servicoIds` padrão = os serviços dos itens.
 */
export function entradaPublica(c: CenarioReserva, sobre: SobreEntradaPublica = {}): EntradaReservaPublica {
  const { profissionalId, inicio, ...resto } = sobre;
  const itens =
    resto.itens ?? [itemPublico(resto.servicoIds?.[0] ?? c.A, profissionalId ?? c.ana, inicio ?? sp(DIA, '10:00').toISOString())];
  return {
    slug: c.s.slugAtual,
    servicoIds: Array.isArray(itens) ? itens.map((i) => i.servicoId) : [],
    nome: 'Maria da Silva',
    telefone: telefoneNovo(),
    aceites: { mensagensReserva: true, conviteAvaliacao: false },
    chaveRequisicao: randomUUID(),
    // IP novo por entrada: os limites por IP não vazam entre os casos (D-027).
    ip: ipNovo(),
    tokenHumano: TOKEN_TURNSTILE_SIMULADO,
    ...resto,
    itens,
  };
}
