'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { iniciarAssinatura } from '@/server/assinatura/assinatura.acao';
import { MENSAGENS_ASSINATURA, mensagemDeIniciar } from '@/server/assinatura/iniciar-tipos';

import type { EstadoAssinar } from './estado';

// Casca Next de /painel/assinatura (D-040): só converte o resultado da ação (defineAcao, que lê o
// cookie) em estado do formulário ou redirect ao checkout. Não acessa repositórios. `redirect` fora de try.

export async function assinarAcao(anterior: EstadoAssinar): Promise<EstadoAssinar> {
  const r = await iniciarAssinatura();
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') {
      redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(ROTAS.assinatura)}`);
    }
    return { ...anterior, mensagem: 'Você não tem permissão para assinar.', sucesso: false };
  }
  const d = r.dados;
  if (d.resultado === 'iniciada') {
    redirect(d.urlCheckout);
  }
  revalidatePath(ROTAS.assinatura);
  return { ...anterior, mensagem: mensagemDeIniciar(d) || MENSAGENS_ASSINATURA.neutro, sucesso: d.resultado === 'teste_iniciado' };
}
