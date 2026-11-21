'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import {
  atributosCookieAdmin,
  atributosCookieAdminApagado,
  atributosCookiePreauth,
  NOME_COOKIE_ADMIN,
} from '@/server/auth/admin/cookie-admin';
import { MENSAGENS_ADMIN, cadastrarTotp, entrarAdmin, verificarTotpAdmin } from '@/server/auth/admin/login-admin';
import type { ResultadoFator } from '@/server/auth/admin/login-admin';
import { normalizarCodigo } from '@/server/auth/admin/totp';

import type { EstadoAdmin } from './estado';

// Casca Next do login do super admin (D-034 §2). Pré-autenticação: fora de *.acao.ts. Só roda sob
// /admin (S-4): o cookie `ab_admin` tem Path /admin e SameSite=Strict. Sucesso e falha de sessão
// terminam em redirect (PRG), de modo que o fluxo funciona sem JavaScript.

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

/** Etapa 1: e-mail e senha. Sucesso grava o cookie da pré-sessão (10 min) e volta a /admin/entrar. */
export async function entrarAdminAcao(_anterior: EstadoAdmin, formData: FormData): Promise<EstadoAdmin> {
  const email = texto(formData.get('email'));
  const r = await entrarAdmin({ email, senha: texto(formData.get('senha')) });
  if (!r.ok) {
    return {
      mensagem: r.motivo === 'recusado' ? r.mensagem : null,
      erros: r.motivo === 'validacao' ? r.erros : {},
      email: email.trim().slice(0, 254),
    };
  }
  (await cookies()).set(NOME_COOKIE_ADMIN, r.token, atributosCookiePreauth());
  redirect(ROTAS.adminEntrar);
}

const ESTADO_VAZIO: EstadoAdmin = { mensagem: null, erros: {}, email: '' };

async function concluirFator(
  fator: (token: string, codigo: unknown) => Promise<ResultadoFator>,
  formData: FormData,
): Promise<EstadoAdmin> {
  const codigo = texto(formData.get('codigo'));
  if (normalizarCodigo(codigo) === null) {
    return { ...ESTADO_VAZIO, erros: { codigo: MENSAGENS_ADMIN.codigoVazio } };
  }
  const jar = await cookies();
  const token = jar.get(NOME_COOKIE_ADMIN)?.value;
  const r = token ? await fator(token, codigo) : ({ ok: false, motivo: 'sessao' } as const);
  if (r.ok) {
    jar.set(NOME_COOKIE_ADMIN, r.token, atributosCookieAdmin());
    redirect(ROTAS.admin);
  }
  if (r.motivo === 'sessao') {
    jar.set(NOME_COOKIE_ADMIN, '', atributosCookieAdminApagado());
    redirect(`${ROTAS.adminEntrar}?aviso=expirou`);
  }
  if (r.motivo === 'ativado') {
    // Outro cadastro concluiu primeiro: a página passa a pedir só o código.
    redirect(ROTAS.adminEntrar);
  }
  return { ...ESTADO_VAZIO, mensagem: r.motivo === 'limite' ? MENSAGENS_ADMIN.limite : MENSAGENS_ADMIN.codigo };
}

/** Etapa 2 (TOTP já cadastrado). */
export async function verificarTotpAcao(_anterior: EstadoAdmin, formData: FormData): Promise<EstadoAdmin> {
  return concluirFator((token, codigo) => verificarTotpAdmin(token, codigo), formData);
}

/** Primeiro acesso: confirma o código do segredo exibido e ativa o TOTP. */
export async function cadastrarTotpAcao(_anterior: EstadoAdmin, formData: FormData): Promise<EstadoAdmin> {
  return concluirFator((token, codigo) => cadastrarTotp(token, codigo), formData);
}
