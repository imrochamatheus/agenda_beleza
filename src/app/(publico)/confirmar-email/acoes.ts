'use server';

import { reenviarConfirmacao } from '@/server/auth/confirmacao-email';

import type { EstadoReenvio } from './estado';

// Casca Next do reenvio do link de confirmação (D-011 §3.6). Fora de *.acao.ts: pré-autenticação.

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

/** Com `token` (tela de link expirado) reenvia pelo dono do token; senão, pelo e-mail informado. */
export async function reenviarConfirmacaoAcao(_anterior: EstadoReenvio, formData: FormData): Promise<EstadoReenvio> {
  const token = formData.get('token');
  const emailBruto = texto(formData.get('email'));
  const r = typeof token === 'string' ? await reenviarConfirmacao({ token }) : await reenviarConfirmacao({ email: emailBruto });
  const email = emailBruto.trim().slice(0, 254);
  if (r.ok) {
    return { mensagem: r.mensagem, variante: 'sucesso', erroEmail: null, email };
  }
  if (r.motivo === 'limite') {
    return { mensagem: r.mensagem, variante: 'erro', erroEmail: null, email };
  }
  return { mensagem: null, variante: null, erroEmail: r.erros.email, email };
}
