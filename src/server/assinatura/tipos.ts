// Contratos client-safe da assinatura (D-037 §3). Sem imports de servidor.
import type { EstadoAssinatura, MotivoIgnorado } from '@/domain/assinatura';

export type { EstadoAssinatura, MotivoIgnorado };
export type { EstadoEfetivo, CapacidadeOperacional } from '@/domain/assinatura';

/**
 * E6.1/E6.2: passe `assinaturaId` resolvido por `provedor_assinatura_id`; sem ele o evento cai na
 * assinatura vigente do salão (R-2: um pagamento tardio pode cair numa assinatura nova).
 */
export type EventoAssinatura =
  | { tipo: 'teste_iniciado'; iniciadoEm?: Date }
  | { tipo: 'cobranca_aprovada'; pagamentoId: string; valorCentavos: number; pagoEm: Date }
  | { tipo: 'cobranca_falhou'; pagamentoId?: string; valorCentavos?: number; falhouEm: Date }
  | { tipo: 'cancelamento' }
  | { tipo: 'prazo' };

export type ResultadoAssinatura =
  | { resultado: 'aplicado'; de: EstadoAssinatura | null; para: EstadoAssinatura; transicoes: number; pagoAte: Date | null }
  | { resultado: 'sem_efeito'; motivo?: 'pagamento_duplicado' }
  | { resultado: 'ignorado'; motivo: MotivoIgnorado }
  | { resultado: 'sem_assinatura' }
  | { resultado: 'ocupada' };
