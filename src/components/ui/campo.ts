// Auxiliares comuns de Field, Select e Checkbox (D-009 RN-9). Puro.

export type IdsDoCampo = { controle: string; ajuda: string; erro: string };

/** Ids do controle, da ajuda e do erro a partir de um id base. */
export function idsDoCampo(base: string): IdsDoCampo {
  return { controle: base, ajuda: `${base}-ajuda`, erro: `${base}-erro` };
}

/**
 * Valor de aria-describedby: ajuda e erro, nessa ordem, mais um valor extra do consumidor.
 * undefined quando não há nada a descrever.
 */
export function descritoPor(
  ids: IdsDoCampo,
  temAjuda: boolean,
  temErro: boolean,
  extra?: string,
): string | undefined {
  const lista = [temAjuda ? ids.ajuda : '', temErro ? ids.erro : '', extra ?? ''].filter(Boolean);
  return lista.length > 0 ? lista.join(' ') : undefined;
}

/** Junta classes, ignorando vazias. */
export function classes(...nomes: (string | false | null | undefined)[]): string {
  return nomes.filter(Boolean).join(' ');
}
