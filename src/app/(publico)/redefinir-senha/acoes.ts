'use server';

import { MENSAGENS_RECUPERACAO, redefinirSenha } from '@/server/auth/recuperacao-senha';

import type { EstadoRedefinir } from './estado';

// Casca Next da redefinição de senha (D-012 §3.4). Fora de *.acao.ts: pré-autenticação. Sem
// redirect e sem cookie (D-7): o estado da ação leva à tela "Senha alterada", também sem JS (D-18).
// O estado devolvido nunca contém a senha nem o token.

/** Lê só `token` e `senha` (não-texto vira vazio/ausente); qualquer outro campo é ignorado. */
export async function redefinirSenhaAcao(_anterior: EstadoRedefinir, formData: FormData): Promise<EstadoRedefinir> {
  const token = formData.get('token');
  const senha = formData.get('senha');
  const r = await redefinirSenha({
    token: typeof token === 'string' ? token : '',
    senha: typeof senha === 'string' ? senha : undefined,
  });
  if (r.ok) {
    return { status: 'sucesso', mensagem: r.mensagem, erroSenha: null };
  }
  switch (r.motivo) {
    case 'validacao':
      return { status: 'formulario', mensagem: null, erroSenha: r.erros.senha };
    case 'recusado':
      return { status: 'recusado', mensagem: MENSAGENS_RECUPERACAO.recusado, erroSenha: null };
    default:
      return { status: 'formulario', mensagem: MENSAGENS_RECUPERACAO.falha, erroSenha: null };
  }
}
