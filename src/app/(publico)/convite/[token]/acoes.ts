'use server';

import { MENSAGENS_CONVITE, aceitarConvite } from '@/server/auth/convite';

import type { EstadoConvite } from './estado';

// Casca Next do aceite do convite (D-039 §2). Fora de *.acao.ts: pré-autenticação. Sem redirect, sem
// cookie e sem login automático: o estado da ação leva à tela "Senha definida", também sem JS. O estado
// devolvido nunca contém a senha nem o token.

/** Lê só `token` e `senha` (não-texto vira vazio/ausente); qualquer outro campo é ignorado. */
export async function aceitarConviteAcao(_anterior: EstadoConvite, formData: FormData): Promise<EstadoConvite> {
  const token = formData.get('token');
  const senha = formData.get('senha');
  const r = await aceitarConvite({
    token: typeof token === 'string' ? token : '',
    senha: typeof senha === 'string' ? senha : undefined,
  });
  switch (r.resultado) {
    case 'aceito':
      return { status: 'sucesso', mensagem: r.mensagem, erroSenha: null };
    case 'invalido':
      return { status: 'formulario', mensagem: null, erroSenha: r.erros.senha };
    case 'recusado':
      return { status: 'recusado', mensagem: MENSAGENS_CONVITE.recusado, erroSenha: null };
    default:
      return { status: 'formulario', mensagem: MENSAGENS_CONVITE.falha, erroSenha: null };
  }
}
