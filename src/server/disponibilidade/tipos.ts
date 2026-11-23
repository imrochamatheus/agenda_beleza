// Contratos do serviço de disponibilidade (D-018 §3.4; D-050 §3.4: por serviço). Sem imports de runtime
// de servidor: só tipos.
import type { DiaDeDisponibilidade } from '@/domain/disponibilidade';
import type { DataCivil } from '@/server/tempo/fuso';

export const LIMITE_SERVICOS = 10;

/** Item da MESMA reserva ainda não gravado (D-050 RN-10). O fim é `inicio + duração do serviço`. */
export type ItemJaEscolhido = { servicoId: string; profissionalId: string; inicio: Date };

export type EntradaDisponibilidadePorServico = {
  /** 1..10, sem repetição (validarServicos). */
  servicoIds: readonly string[];
  /** Período de datas civis, inclusive. */
  de: DataCivil;
  ate: DataCivil;
  /** Relógio injetado, obrigatório. */
  agora: Date;
  /**
   * Itens da MESMA reserva ainda não gravados; no máximo um por serviço, cada `servicoId` em `servicoIds`.
   * Para o serviço k contam os de `servicoId ≠ k`: ocupam o próprio profissional com
   * `[inicio, fim + intervalo)` (RN-9) e a cliente com `[inicio, fim)` para todos (RN-8).
   */
  escolhidos?: readonly ItemJaEscolhido[];
  /** Subconjunto de `servicoIds` a calcular (padrão todos). Não muda o número de SQL. */
  calcular?: readonly string[];
  /**
   * Revalidação: limita o candidato de cada serviço a um profissional. Quando presente (não vazio), deve
   * ter uma entrada para CADA serviço calculado. Valor malformado, de outro salão ou inexistente →
   * NaoEncontrado; inativo ou não vinculado ao serviço → aquele serviço sem profissionais.
   */
  profissionalPorServico?: Readonly<Record<string, string>>;
};

export type MotivoEntradaInvalida =
  | 'servicos_vazio'
  | 'servicos_repetidos'
  | 'servicos_demais'
  | 'data_invalida'
  | 'periodo_invertido'
  | 'periodo_longo'
  /** `escolhidos` com serviço fora de `servicoIds`, serviço repetido ou início inválido. */
  | 'escolhidos_invalidos'
  /** `calcular` vazio ou com serviço fora de `servicoIds`; `profissionalPorServico` sem cobrir `calcular`. */
  | 'calculo_invalido';

export type MotivoServicos = Extract<MotivoEntradaInvalida, 'servicos_vazio' | 'servicos_repetidos' | 'servicos_demais'>;

export type DisponibilidadeDeProfissional = { profissionalId: string; nome: string; dias: DiaDeDisponibilidade[] };

export type DisponibilidadeDoServico = {
  servicoId: string;
  nome: string;
  duracaoMin: number;
  precoCentavos: number;
  /** Ativos vinculados AO serviço (RN-7), ordem nome, id. Cada um com todas as datas pedidas. */
  profissionais: DisponibilidadeDeProfissional[];
  /** C3: nenhum horário no período COM o desconto dos escolhidos, mas haveria sem ele. */
  vazioPorConflito: boolean;
};

export type ResultadoDisponibilidadePorServico =
  | {
      resultado: 'ok';
      fuso: string;
      intervaloMin: number;
      /** Os serviços calculados, na ordem de `servicoIds`. */
      servicos: DisponibilidadeDoServico[];
    }
  | { resultado: 'servico_indisponivel' }
  | { resultado: 'entrada_invalida'; motivo: MotivoEntradaInvalida };
