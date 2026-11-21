'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { atributosCookieAdminApagado, NOME_COOKIE_ADMIN } from '@/server/auth/admin/cookie-admin';
import { encerrarSessaoAdmin } from '@/server/auth/admin/sessao-admin';

// Logout do super admin (D-034 RN-8): só por POST (ação de servidor, com a checagem de origem do
// Next). Idempotente: sem cookie ou com sessão já revogada, só apaga o cookie e redireciona.

export async function sairAdminAcao(): Promise<void> {
  const jar = await cookies();
  await encerrarSessaoAdmin(jar.get(NOME_COOKIE_ADMIN)?.value);
  jar.set(NOME_COOKIE_ADMIN, '', atributosCookieAdminApagado());
  console.info(JSON.stringify({ evento: 'admin.logout', em: new Date().toISOString() }));
  redirect(ROTAS.adminEntrar);
}
