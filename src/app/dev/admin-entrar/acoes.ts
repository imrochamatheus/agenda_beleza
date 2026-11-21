'use server';

import type { EstadoAdmin } from '@/app/admin/entrar/estado';
import { MENSAGENS_ADMIN, validarCredenciaisAdmin } from '@/server/auth/admin/login-admin';
import { normalizarCodigo } from '@/server/auth/admin/totp';
import { vitrineHabilitada } from '@/server/env';

// Ações de demonstração de /dev/admin-entrar (D-034): só a validação PURA do servidor, sem banco,
// sessão, cookie nem rede. Desligada a vitrine, devolvem o estado anterior sem processar.

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
const AVISO = 'Demonstração: formato válido, nada foi enviado.';

export async function demonstrarCredenciaisAcao(anterior: EstadoAdmin, fd: FormData): Promise<EstadoAdmin> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const email = texto(fd.get('email')).trim().slice(0, 254);
  const v = validarCredenciaisAdmin({ email, senha: texto(fd.get('senha')) });
  return v.ok ? { mensagem: null, erros: {}, email, aviso: AVISO } : { mensagem: null, erros: v.erros, email };
}

export async function demonstrarCodigoAcao(anterior: EstadoAdmin, fd: FormData): Promise<EstadoAdmin> {
  if (!vitrineHabilitada(process.env)) return anterior;
  return normalizarCodigo(texto(fd.get('codigo'))) === null
    ? { mensagem: null, erros: { codigo: MENSAGENS_ADMIN.codigoVazio }, email: '' }
    : { mensagem: null, erros: {}, email: '', aviso: AVISO };
}
