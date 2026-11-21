import { TABELA_CAPACIDADES } from './capacidades';
import type { Capacidades, SituacaoOperacional } from './capacidades';
import { ESTADOS_ASSINATURA } from './tipos';
import type { EstadoAssinatura } from './tipos';

export type EstadoBruto = {
  suspensoManualEm: Date | null;
  assinatura: { estado: string; carenciaAte: Date | null; acessoAte: Date | null } | null;
};

export type EstadoEfetivo = {
  estado: SituacaoOperacional;
  motivo: 'manual' | 'assinatura' | 'cancelada_vencida' | 'sem_assinatura';
  capacidades: Capacidades;
  carenciaAte?: Date;
  acessoAte?: Date;
};

const copia = (s: SituacaoOperacional): Capacidades => ({ ...TABELA_CAPACIDADES[s] });

/** Estado efetivo (D-037 §3.3): suspensão manual prevalece; `cancelada` vencida conta como `encerrada`. */
export function decidirEstadoEfetivo(bruto: EstadoBruto, agora: Date): EstadoEfetivo {
  if (bruto.suspensoManualEm !== null) {
    return { estado: 'manual', motivo: 'manual', capacidades: copia('manual') };
  }
  const a = bruto.assinatura;
  if (a === null) {
    return { estado: 'sem_assinatura', motivo: 'sem_assinatura', capacidades: copia('sem_assinatura') };
  }
  if (!(ESTADOS_ASSINATURA as readonly string[]).includes(a.estado)) {
    return { estado: 'encerrada', motivo: 'assinatura', capacidades: copia('encerrada') };
  }
  const estado = a.estado as EstadoAssinatura;
  if (estado === 'cancelada') {
    if (a.acessoAte === null || a.acessoAte.getTime() <= agora.getTime()) {
      return { estado: 'encerrada', motivo: 'cancelada_vencida', capacidades: copia('encerrada') };
    }
    return { estado, motivo: 'assinatura', capacidades: copia(estado), acessoAte: a.acessoAte };
  }
  const r: EstadoEfetivo = { estado, motivo: 'assinatura', capacidades: copia(estado) };
  if (estado === 'em_carencia' && a.carenciaAte !== null) {
    r.carenciaAte = a.carenciaAte;
  }
  return r;
}
