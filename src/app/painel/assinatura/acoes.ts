'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { cancelarAssinatura, iniciarAssinatura, regularizarAssinatura } from '@/server/assinatura/assinatura.acao';
import { mensagemDeCancelar } from '@/server/assinatura/cancelar-tipos';
import { MENSAGENS_ASSINATURA, mensagemDeIniciar } from '@/server/assinatura/iniciar-tipos';
import { mensagemDeRegularizar } from '@/server/assinatura/regularizar-tipos';

import type { EstadoAcaoAssinatura } from './estado';

// Casca Next de /painel/assinatura (D-040, D-042): só converte o resultado das ações (defineAcao, que lê o
// cookie) em estado do formulário ou redirect ao checkout/provedor. Não acessa repositórios. `redirect`
// fora de try. Nenhuma recebe id de assinatura; `estadoVisto` (campo oculto) é só dica de UX.

const agora = () => Date.now();

function semPermissao(anterior: EstadoAcaoAssinatura, texto: string): EstadoAcaoAssinatura {
  return { ...anterior, mensagem: texto, variante: 'aviso', em: agora() };
}

function paraEntrar(): never {
  redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(ROTAS.assinatura)}`);
}

export async function assinarAcao(anterior: EstadoAcaoAssinatura): Promise<EstadoAcaoAssinatura> {
  const r = await iniciarAssinatura();
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar();
    return semPermissao(anterior, 'Você não tem permissão para assinar.');
  }
  const d = r.dados;
  if (d.resultado === 'iniciada') {
    redirect(d.urlCheckout);
  }
  revalidatePath(ROTAS.assinatura);
  return {
    mensagem: mensagemDeIniciar(d) || MENSAGENS_ASSINATURA.neutro,
    variante: d.resultado === 'teste_iniciado' ? 'sucesso' : d.resultado === 'provedor_indisponivel' ? 'erro' : 'aviso',
    em: agora(),
  };
}

export async function regularizarAcao(anterior: EstadoAcaoAssinatura): Promise<EstadoAcaoAssinatura> {
  const r = await regularizarAssinatura();
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar();
    return semPermissao(anterior, 'Você não tem permissão para atualizar o meio de pagamento.');
  }
  if (r.dados.resultado === 'iniciada') {
    redirect(r.dados.url);
  }
  revalidatePath(ROTAS.assinatura);
  const m = mensagemDeRegularizar(r.dados);
  return { mensagem: m.texto, variante: m.variante, em: agora() };
}

export async function cancelarAcao(anterior: EstadoAcaoAssinatura, formData: FormData): Promise<EstadoAcaoAssinatura> {
  const visto = formData.get('estadoVisto');
  const r = await cancelarAssinatura({ estadoVisto: typeof visto === 'string' ? visto : undefined });
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar();
    return semPermissao(anterior, 'Você não tem permissão para cancelar a assinatura.');
  }
  revalidatePath(ROTAS.assinatura);
  const m = mensagemDeCancelar(r.dados);
  return { mensagem: m.texto, variante: m.variante, em: agora() };
}
