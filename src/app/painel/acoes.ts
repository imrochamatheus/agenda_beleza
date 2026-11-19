'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { atributosCookieApagado, NOME_COOKIE_SESSAO } from '@/server/auth/cookie';
import { encerrarSessao } from '@/server/auth/sessao';

// Logout (D-010 RN-12, D-14): só por POST (ação de servidor, com a checagem de origem do Next).
// Idempotente: sem cookie ou com sessão já revogada, só apaga o cookie e redireciona.

export async function sairAcao(): Promise<void> {
  const jar = await cookies();
  await encerrarSessao(jar.get(NOME_COOKIE_SESSAO)?.value);
  jar.set(NOME_COOKIE_SESSAO, '', atributosCookieApagado());
  console.info(JSON.stringify({ evento: 'auth.logout', em: new Date().toISOString() }));
  redirect(ROTAS.entrar);
}
