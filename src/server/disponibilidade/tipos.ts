// Contratos do serviço de disponibilidade (D-018 §3.4). Sem imports de runtime de servidor: só tipos.
import type { DiaDeDisponibilidade } from '@/domain/disponibilidade';
import type { DataCivil } from '@/server/tempo/fuso';

export const LIMITE_SERVICOS = 10;

export type EntradaDisponibilidade = {
  /** 1..10, sem repetição (D-4). */
  servicoIds: readonly string[];
  /** Opcional (D-3). */
  profissionalId?: string | null;
  /** Período de datas civis, inclusive (D-1). */
  de: DataCivil;
  ate: DataCivil;
  /** Relógio injetado, obrigatório (D-6). */
  agora: Date;
};

export type MotivoEntradaInvalida =
  | 'servicos_vazio'
  | 'servicos_repetidos'
  | 'servicos_demais'
  | 'data_invalida'
  | 'periodo_invertido'
  | 'periodo_longo';

export type MotivoServicos = Extract<MotivoEntradaInvalida, 'servicos_vazio' | 'servicos_repetidos' | 'servicos_demais'>;

export type ServicoEscolhido = { id: string; nome: string; duracaoMin: number; precoCentavos: number };

export type DisponibilidadeDeProfissional = { profissionalId: string; nome: string; dias: DiaDeDisponibilidade[] };

export type ResultadoDisponibilidade =
  | {
      resultado: 'ok';
      fuso: string;
      duracaoTotalMin: number;
      precoTotalCentavos: number;
      /** Na ordem de `servicoIds`. */
      servicos: ServicoEscolhido[];
      /** Ordem nome, id (RN-17). */
      profissionais: DisponibilidadeDeProfissional[];
    }
  | { resultado: 'servico_indisponivel' }
  | { resultado: 'entrada_invalida'; motivo: MotivoEntradaInvalida };

export type ResultadoElegiveis =
  | { resultado: 'ok'; profissionais: { id: string; nome: string }[] }
  | { resultado: 'servico_indisponivel' }
  | { resultado: 'entrada_invalida'; motivo: MotivoServicos };
