import type { EstadoAssinatura } from './tipos';

// Tabela única de capacidades por situação (D-037 RN-7; a E6.4 a consome).

export const CAPACIDADES_OPERACIONAIS = ['leitura', 'configurar', 'agendar', 'cancelar', 'assinatura', 'lgpd'] as const;
export type CapacidadeOperacional = (typeof CAPACIDADES_OPERACIONAIS)[number];
export type Capacidades = Record<CapacidadeOperacional, boolean>;

const montar = (liberadas: readonly CapacidadeOperacional[]): Capacidades =>
  Object.fromEntries(CAPACIDADES_OPERACIONAIS.map((c) => [c, liberadas.includes(c)])) as Capacidades;

const TUDO = montar(CAPACIDADES_OPERACIONAIS);
const SOMENTE_LEITURA = montar(['leitura', 'cancelar', 'assinatura', 'lgpd']);

export type SituacaoOperacional = EstadoAssinatura | 'manual' | 'sem_assinatura';

export const TABELA_CAPACIDADES: Readonly<Record<SituacaoOperacional, Readonly<Capacidades>>> = {
  pendente: montar(['leitura', 'configurar', 'cancelar', 'assinatura', 'lgpd']),
  em_teste: TUDO,
  ativa: TUDO,
  em_carencia: TUDO,
  cancelada: TUDO,
  suspensa: SOMENTE_LEITURA,
  encerrada: SOMENTE_LEITURA,
  manual: SOMENTE_LEITURA,
  sem_assinatura: TUDO,
};
