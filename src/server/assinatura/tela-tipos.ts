// Contratos client-safe da tela da assinatura (D-042). Sem imports de servidor; o provedor nunca aparece.
import type { EstadoAssinatura, SituacaoOperacional } from '@/domain/assinatura';

export type AcaoPrimaria = 'assinar' | 'continuar' | 'regularizar' | 'atualizar' | 'assinar_novamente';

export type AcoesDaTela = { primaria: AcaoPrimaria | null; podeCancelar: boolean };

/** Datas do estado (só as que se aplicam a ele; nulas no banco ficam ausentes). */
export type DatasDaTela = { testeFimEm?: Date; periodoPagoAte?: Date; carenciaAte?: Date; acessoAte?: Date };

export type PagamentoDaTela = { data: Date; valorCentavos: number; situacao: 'aprovado' | 'recusado' };

export type TelaAssinatura = {
  estado: SituacaoOperacional;
  /** Estado gravado da assinatura mais recente (dica `estadoVisto` da etapa 2); `null` sem assinatura. */
  estadoReal: EstadoAssinatura | null;
  fuso: string;
  datas: DatasDaTela;
  acoes: AcoesDaTela;
  pagamentos: PagamentoDaTela[];
};

export const LIMITE_PAGAMENTOS = 12;

/** Matriz de ações por estado efetivo (RN-6, RN-7, RN-8; `manual` e `cancelada` não têm ação). */
export function acoesDoEstado(estado: SituacaoOperacional): AcoesDaTela {
  switch (estado) {
    case 'sem_assinatura':
      return { primaria: 'assinar', podeCancelar: false };
    case 'pendente':
      return { primaria: 'continuar', podeCancelar: true };
    case 'em_teste':
      return { primaria: null, podeCancelar: true };
    case 'ativa':
      return { primaria: 'atualizar', podeCancelar: true };
    case 'em_carencia':
    case 'suspensa':
      return { primaria: 'regularizar', podeCancelar: true };
    case 'encerrada':
      return { primaria: 'assinar_novamente', podeCancelar: false };
    default:
      return { primaria: null, podeCancelar: false };
  }
}
