'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { atributosCookieSessao, NOME_COOKIE_SESSAO } from '@/server/auth/cookie';
import { entrar } from '@/server/auth/login';

import type { EstadoEntrar } from './estado';

// Casca Next do login (D-010 §3.12, D-11). Fora de *.acao.ts (RN-24): login é pré-autenticação.

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

/** Ação do formulário de /entrar: sucesso grava o cookie httpOnly e redireciona; falha devolve o estado. */
export async function entrarAcao(_anterior: EstadoEntrar, formData: FormData): Promise<EstadoEntrar> {
  const email = texto(formData.get('email'));
  const r = await entrar({ email, senha: texto(formData.get('senha')), proximo: texto(formData.get('proximo')) });
  if (!r.ok) {
    return {
      mensagem: r.motivo === 'recusado' ? r.mensagem : null,
      erros: r.motivo === 'validacao' ? r.erros : {},
      email: email.trim().slice(0, 254),
    };
  }
  (await cookies()).set(NOME_COOKIE_SESSAO, r.token, atributosCookieSessao());
  redirect(r.destino);
}
