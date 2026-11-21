import { PREAUTH_MS, TETO_ADMIN_MS } from './validade-admin';

// Cookie do super admin (D-034 RN-8, S-4). Puro: o proxy importa daqui o nome sem puxar o Prisma.
// SameSite=Strict e Path=/admin: nunca viaja para o painel do salão nem para a página pública.

export const NOME_COOKIE_ADMIN = 'ab_admin';

export type AtributosCookieAdmin = {
  httpOnly: true;
  sameSite: 'strict';
  path: '/admin';
  secure: boolean;
  maxAge: number;
};

function base(nodeEnv: string | undefined, maxAge: number): AtributosCookieAdmin {
  return { httpOnly: true, sameSite: 'strict', path: '/admin', secure: nodeEnv === 'production', maxAge };
}

/** Sessão admin: Max-Age = teto de 8 h. */
export function atributosCookieAdmin(nodeEnv: string | undefined = process.env.NODE_ENV): AtributosCookieAdmin {
  return base(nodeEnv, TETO_ADMIN_MS / 1000);
}

/** Pré-sessão: Max-Age de 10 min. */
export function atributosCookiePreauth(nodeEnv: string | undefined = process.env.NODE_ENV): AtributosCookieAdmin {
  return base(nodeEnv, PREAUTH_MS / 1000);
}

export function atributosCookieAdminApagado(nodeEnv: string | undefined = process.env.NODE_ENV): AtributosCookieAdmin {
  return base(nodeEnv, 0);
}
