// Validade da sessão do super admin (D-034 RN-7, RN-8, S-5). Puro, sem imports. Política própria:
// não usa nem altera `auth/validade.ts` (a renovação de 7/30 dias do salão não vale aqui).

const MINUTO_MS = 60 * 1000;

/** Pré-sessão (senha certa, TOTP pendente): 10 minutos, sem renovação. */
export const PREAUTH_MS = 10 * MINUTO_MS;
/** Sessão admin: 30 minutos de inatividade, renovada no uso. */
export const INATIVIDADE_ADMIN_MS = 30 * MINUTO_MS;
/** Teto absoluto desde `criado_em`: 8 horas. */
export const TETO_ADMIN_MS = 8 * 60 * MINUTO_MS;
/** No máximo uma escrita de renovação por minuto por sessão. */
export const INTERVALO_RENOVACAO_ADMIN_MS = MINUTO_MS;

export function expiracaoPreauth(agora: Date): Date {
  return new Date(agora.getTime() + PREAUTH_MS);
}

/** min(agora + 30 min, criadoEm + 8 h). */
export function expiracaoAdmin(criadoEm: Date, agora: Date): Date {
  return new Date(Math.min(agora.getTime() + INATIVIDADE_ADMIN_MS, criadoEm.getTime() + TETO_ADMIN_MS));
}

/** Renova se nunca houve uso ou se o último foi há mais de 1 min. */
export function precisaRenovarAdmin(ultimoUsoEm: Date | null, agora: Date): boolean {
  return ultimoUsoEm === null || ultimoUsoEm.getTime() < agora.getTime() - INTERVALO_RENOVACAO_ADMIN_MS;
}
