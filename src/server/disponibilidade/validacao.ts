// Validação estrutural pura da consulta de disponibilidade (D-018 RN-15, CA-21). Sem banco: nenhum
// caso inválido chega a consultar reserva. O limite "no máximo janela_dias + 1 datas" depende do salão
// e é conferido pelo serviço depois de ler as regras.
import { compararDatas, ehDataCivilValida } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

import { LIMITE_SERVICOS } from './tipos';
import type { MotivoEntradaInvalida, MotivoServicos } from './tipos';

/** Lista de serviços: 1..10, sem repetição. */
export function validarServicos(servicoIds: readonly string[]): MotivoServicos | null {
  if (!Array.isArray(servicoIds) || servicoIds.length === 0) return 'servicos_vazio';
  if (servicoIds.length > LIMITE_SERVICOS) return 'servicos_demais';
  if (new Set(servicoIds).size !== servicoIds.length) return 'servicos_repetidos';
  return null;
}

/** Datas civis válidas e `ate >= de`. */
export function validarPeriodo(de: DataCivil, ate: DataCivil): 'data_invalida' | 'periodo_invertido' | null {
  if (!ehDataCivilValida(de) || !ehDataCivilValida(ate)) return 'data_invalida';
  if (compararDatas(ate, de) < 0) return 'periodo_invertido';
  return null;
}

export function validarEntradaEstrutural(e: {
  servicoIds: readonly string[];
  de: DataCivil;
  ate: DataCivil;
}): MotivoEntradaInvalida | null {
  return validarServicos(e.servicoIds) ?? validarPeriodo(e.de, e.ate);
}
