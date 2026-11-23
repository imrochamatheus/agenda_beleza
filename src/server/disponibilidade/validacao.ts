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

const instanteValido = (d: unknown): boolean => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * D-050: itens já escolhidos. Cada `servicoId` em `servicoIds`, no máximo um por serviço, `inicio` um
 * instante válido e `profissionalId` texto (malformado não é erro: só nunca coincide com um candidato).
 */
export function validarEscolhidos(
  servicoIds: readonly string[],
  escolhidos: readonly { servicoId: string; profissionalId: string; inicio: Date }[] | undefined,
): 'escolhidos_invalidos' | null {
  if (escolhidos === undefined) return null;
  if (!Array.isArray(escolhidos)) return 'escolhidos_invalidos';
  const pedidos = new Set(servicoIds);
  const vistos = new Set<string>();
  for (const e of escolhidos) {
    if (e === null || typeof e !== 'object') return 'escolhidos_invalidos';
    if (!pedidos.has(e.servicoId) || vistos.has(e.servicoId)) return 'escolhidos_invalidos';
    if (typeof e.profissionalId !== 'string' || !instanteValido(e.inicio)) return 'escolhidos_invalidos';
    vistos.add(e.servicoId);
  }
  return null;
}

/**
 * D-050: `calcular` (padrão todos) é um subconjunto não vazio de `servicoIds`; `profissionalPorServico`,
 * quando presente e não vazio, só tem chaves de `servicoIds`, valores texto, e cobre todo serviço calculado.
 */
export function validarCalculo(
  servicoIds: readonly string[],
  calcular: readonly string[] | undefined,
  profissionalPorServico: Readonly<Record<string, string>> | undefined,
): 'calculo_invalido' | null {
  const pedidos = new Set(servicoIds);
  if (calcular !== undefined) {
    if (!Array.isArray(calcular) || calcular.length === 0) return 'calculo_invalido';
    if (!calcular.every((id) => pedidos.has(id))) return 'calculo_invalido';
  }
  if (profissionalPorServico === undefined) return null;
  if (profissionalPorServico === null || typeof profissionalPorServico !== 'object') return 'calculo_invalido';
  const chaves = Object.keys(profissionalPorServico);
  if (chaves.length === 0) return null;
  if (!chaves.every((k) => pedidos.has(k) && typeof profissionalPorServico[k] === 'string')) return 'calculo_invalido';
  const alvo = calcular ?? servicoIds;
  if (!alvo.every((k) => Object.hasOwn(profissionalPorServico, k))) return 'calculo_invalido';
  return null;
}
