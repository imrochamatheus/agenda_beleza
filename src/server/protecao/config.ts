// Configuração da proteção (D-027): lida a cada uso de `process.env` (testes mudam o ambiente), validada
// pelo mesmo esquema do check-env. Só o RATE_LIMIT_SEGREDO tem tratamento próprio.
import { lerProtecao } from '@/server/env';
import type { ConfigProtecao } from '@/server/env';

export type { ConfigProtecao };

/** Padrão fixo, só fora de produção. Em produção o check-env exige RATE_LIMIT_SEGREDO. */
export const SEGREDO_DE_DESENVOLVIMENTO = 'agenda-beleza-dev-segredo-do-limite-nao-usar-em-producao';

export function configDaProtecao(fonte: Record<string, string | undefined> = process.env): ConfigProtecao {
  return lerProtecao(fonte);
}

export function segredoDoLimite(fonte: Record<string, string | undefined> = process.env): string {
  const valor = fonte.RATE_LIMIT_SEGREDO;
  if (valor !== undefined && valor !== '') {
    if (valor.length < 32) throw new Error('RATE_LIMIT_SEGREDO deve ter ao menos 32 caracteres');
    return valor;
  }
  if (fonte.NODE_ENV === 'production') throw new Error('RATE_LIMIT_SEGREDO é obrigatório em produção');
  return SEGREDO_DE_DESENVOLVIMENTO;
}
