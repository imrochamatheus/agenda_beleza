import { z } from 'zod';

import { normalizarNome } from '@/lib/texto';
import { ehUuid } from '@/server/repos/ids';

import { LIMITES_SERVICO, MENSAGENS_SERVICO } from './tipos';
import type { ErrosServico } from './tipos';

// Validação dos dados do serviço (D-014 RN-1, §3.3). Pura: sem banco. Toda validação acontece no
// servidor; a do navegador é só conveniência. O preço é convertido por texto e aritmética inteira:
// nunca parseFloat nem Number sobre texto com casas decimais.

export type DadosServicoValidos = {
  nome: string;
  precoCentavos: number;
  duracaoMin: number;
  /** Ids deduplicados, em minúsculas. A pertença ao salão e o estado ativo são conferidos no banco. */
  profissionais: string[];
};

/**
 * D-1: prefixo opcional `R$` (com ou sem espaço, inclusive U+00A0); parte inteira só com dígitos ou
 * com milhar por ponto em grupos de 3; vírgula decimal opcional com 1 ou 2 dígitos.
 */
const PADRAO_PRECO = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
/** Acima de 5 dígitos inteiros já passa do teto (R$ 99.999,99): recusa sem converter. */
const MAX_DIGITOS_INTEIROS = 5;

/** Texto → centavos inteiros, ou null (formato inválido ou fora de [0, precoMaxCentavos]). */
export function converterPrecoParaCentavos(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const texto = v.trim();
  if (texto.length === 0 || texto.length > LIMITES_SERVICO.precoMaxCaracteres) return null;
  const casado = PADRAO_PRECO.exec(texto);
  if (!casado) return null;
  const inteiro = casado[1].replaceAll('.', '').replace(/^0+(?=\d)/, '');
  if (inteiro.length > MAX_DIGITOS_INTEIROS) return null;
  // Só dígitos, no máximo 5 (inteiro) e 2 (fração): a conversão é de inteiros pequenos.
  const centavos = Number(inteiro) * 100 + Number((casado[2] ?? '').padEnd(2, '0'));
  return centavos > LIMITES_SERVICO.precoMaxCentavos ? null : centavos;
}

/** Inteiro de minutos (texto só de dígitos, até 4, ou number inteiro seguro), ou null. Sem faixa. */
export function converterDuracao(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null;
  if (typeof v !== 'string') return null;
  const digitos = v.trim();
  return /^\d{1,4}$/.test(digitos) ? Number(digitos) : null;
}

function duracaoValida(v: unknown): number | null {
  const n = converterDuracao(v);
  const { min, max, passo } = LIMITES_SERVICO.duracao;
  return n !== null && n >= min && n <= max && n % passo === 0 ? n : null;
}

/** Array de UUIDs (≤ profissionaisMax itens); devolve os ids deduplicados em minúsculas, ou null. */
export function validarListaDeProfissionais(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > LIMITES_SERVICO.profissionaisMax) return null;
  if (!v.every((id) => ehUuid(id))) return null;
  return [...new Set(v.map((id: string) => id.toLowerCase()))];
}

/** Os quatro campos, todos obrigatórios (D-16: `profissionais` vazio é `[]` explícito). */
const esquemaEntrada = z.strictObject({
  nome: z.unknown(),
  preco: z.unknown(),
  duracao: z.unknown(),
  profissionais: z.unknown(),
});

/** RN-1. Todos os erros de campo juntos. */
export function validarDadosServico(
  e: unknown,
): { ok: true; dados: DadosServicoValidos } | { ok: false; erros: ErrosServico } {
  const entrada = esquemaEntrada.safeParse(e);
  // z.unknown() aceita a chave ausente: a presença de `profissionais` é conferida na entrada.
  if (!entrada.success || !Object.hasOwn(e as object, 'profissionais')) {
    return { ok: false, erros: { formulario: MENSAGENS_SERVICO.formulario } };
  }
  const nome = normalizarNome(entrada.data.nome, LIMITES_SERVICO.nome);
  const precoCentavos = converterPrecoParaCentavos(entrada.data.preco);
  const duracaoMin = duracaoValida(entrada.data.duracao);
  const profissionais = validarListaDeProfissionais(entrada.data.profissionais);
  if (nome === null || precoCentavos === null || duracaoMin === null || profissionais === null) {
    const erros: ErrosServico = {};
    if (nome === null) erros.nome = MENSAGENS_SERVICO.nome;
    if (precoCentavos === null) erros.preco = MENSAGENS_SERVICO.preco;
    if (duracaoMin === null) erros.duracao = MENSAGENS_SERVICO.duracao;
    if (profissionais === null) erros.profissionais = MENSAGENS_SERVICO.profissionais;
    return { ok: false, erros };
  }
  return { ok: true, dados: { nome, precoCentavos, duracaoMin, profissionais } };
}
