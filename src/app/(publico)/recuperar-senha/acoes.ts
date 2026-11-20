'use server';

import { after } from 'next/server';

import { solicitarRecuperacao } from '@/server/auth/recuperacao-senha';

import type { EstadoRecuperar } from './estado';

// Casca Next do pedido de recuperação de senha (D-012 §3.4). Fora de *.acao.ts: pré-autenticação.
// D-4: a busca, a emissão do token e o envio do e-mail rodam DEPOIS da resposta, por `after()`
// (injetado no serviço, que não importa next/*). A resposta não depende de o e-mail existir.

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

/** Lê só o campo `email`; qualquer outro campo do formulário é ignorado. */
export async function solicitarRecuperacaoAcao(_anterior: EstadoRecuperar, formData: FormData): Promise<EstadoRecuperar> {
  const emailBruto = texto(formData.get('email'));
  const r = await solicitarRecuperacao({ email: emailBruto }, { agendar: (tarefa) => after(tarefa) });
  const email = emailBruto.trim().slice(0, 254);
  if (r.ok) {
    return { mensagem: r.mensagem, variante: 'sucesso', erroEmail: null, email };
  }
  if (r.motivo === 'limite') {
    return { mensagem: r.mensagem, variante: 'erro', erroEmail: null, email };
  }
  return { mensagem: null, variante: null, erroEmail: r.erros.email, email };
}
