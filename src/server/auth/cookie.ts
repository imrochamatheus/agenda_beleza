import { TETO_MS } from './validade';

// Cookie de sessão da equipe (D-010 RN-11, D-2, DD-1). Puro: o proxy importa daqui o nome sem puxar
// a cadeia do Prisma. Sem `domain` (vale só para o host) e sem `expires` (o Max-Age basta).

export const NOME_COOKIE_SESSAO = 'ab_sessao';

export type AtributosCookie = {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;
  maxAge: number;
};

/** Atributos de gravação: Max-Age = teto da sessão (30 d); Secure só em produção. */
export function atributosCookieSessao(nodeEnv: string | undefined = process.env.NODE_ENV): AtributosCookie {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: nodeEnv === 'production',
    maxAge: TETO_MS / 1000,
  };
}

/** Atributos de apagamento (logout): os mesmos, com Max-Age 0. */
export function atributosCookieApagado(nodeEnv: string | undefined = process.env.NODE_ENV): AtributosCookie {
  return { ...atributosCookieSessao(nodeEnv), maxAge: 0 };
}
