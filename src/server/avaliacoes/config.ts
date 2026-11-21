// Segredo do HMAC dos links de avaliação (D-032 §3.1). Lido a cada uso; mesmo padrão do RATE_LIMIT_SEGREDO.

/** Padrão fixo, só fora de produção. Em produção o check-env exige AVALIACAO_SEGREDO. */
export const SEGREDO_AVALIACAO_DE_DESENVOLVIMENTO = 'agenda-beleza-dev-segredo-da-avaliacao-nao-usar-em-producao';

export function segredoDeAvaliacao(fonte: Record<string, string | undefined> = process.env): string {
  const valor = fonte.AVALIACAO_SEGREDO;
  if (valor !== undefined && valor !== '') {
    if (valor.length < 32) throw new Error('AVALIACAO_SEGREDO deve ter ao menos 32 caracteres');
    return valor;
  }
  if (fonte.NODE_ENV === 'production') throw new Error('AVALIACAO_SEGREDO é obrigatório em produção');
  return SEGREDO_AVALIACAO_DE_DESENVOLVIMENTO;
}
