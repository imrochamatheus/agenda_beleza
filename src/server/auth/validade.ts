// Validade da sessão (D-010 RN-10, D-1). Puro, sem imports.

const DIA_MS = 24 * 60 * 60 * 1000;

/** Expiração por inatividade: 7 dias, renovada no uso. */
export const INATIVIDADE_MS = 7 * DIA_MS;
/** Teto absoluto desde `criado_em`: 30 dias. Também é o Max-Age do cookie. */
export const TETO_MS = 30 * DIA_MS;
/** No máximo uma escrita de renovação por hora por sessão. */
export const INTERVALO_RENOVACAO_MS = 60 * 60 * 1000;

/** Expiração de uma sessão recém-criada: agora + 7 d. */
export function expiracaoInicial(agora: Date): Date {
  return new Date(agora.getTime() + INATIVIDADE_MS);
}

/** Renova se nunca houve uso registrado ou se o último foi há mais de 1 h. */
export function precisaRenovar(ultimoUsoEm: Date | null, agora: Date): boolean {
  return ultimoUsoEm === null || ultimoUsoEm.getTime() < agora.getTime() - INTERVALO_RENOVACAO_MS;
}

/** min(agora + 7 d, criadoEm + 30 d). */
export function novaExpiracao(criadoEm: Date, agora: Date): Date {
  return new Date(Math.min(agora.getTime() + INATIVIDADE_MS, criadoEm.getTime() + TETO_MS));
}
