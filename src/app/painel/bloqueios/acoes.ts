'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { criarBloqueio, editarBloqueio, removerBloqueio } from '@/server/bloqueios/bloqueios.acao';
import { MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';

import { lerFormularioBloqueio, VALORES_VAZIOS } from './estado';
import type { EstadoFormularioBloqueio } from './estado';

// Casca Next de /painel/bloqueios (D-016 §3.7): só converte FormData → entrada e o resultado da ação
// (defineAcao, que lê o cookie) → estado do formulário. Não acessa repositórios. `redirect` sempre fora
// de try. Criar/editar devolvem o aviso de reservas cobertas no estado (sem PRG, D-19: funciona sem
// JavaScript, pois a página é renderizada na resposta do POST); remover usa PRG com `?remocao=`.

function paraEntrar(rota: string): never {
  redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(rota)}`);
}

/** "Salvar bloqueio" (criação). Depois de salvar, os campos voltam vazios. */
export async function criarBloqueioAcao(_anterior: EstadoFormularioBloqueio, fd: FormData): Promise<EstadoFormularioBloqueio> {
  const { entrada, valores } = lerFormularioBloqueio(fd, 'criar');
  const r = await criarBloqueio(entrada);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar(ROTAS.bloqueios);
    const mensagem = r.erro === 'acesso_negado' ? MENSAGENS_BLOQUEIO.acessoNegado : MENSAGENS_BLOQUEIO.naoEncontrado;
    return { mensagem, erros: {}, valores, salvo: null };
  }
  if (r.dados.resultado === 'invalido') {
    return { mensagem: null, erros: r.dados.erros, valores, salvo: null };
  }
  revalidatePath(ROTAS.bloqueios);
  return { mensagem: null, erros: {}, valores: VALORES_VAZIOS, salvo: { periodo: r.dados.bloqueio.periodo, aviso: r.dados.aviso } };
}

/** "Salvar alterações" (edição). Os campos ficam com os valores enviados. */
export async function editarBloqueioAcao(_anterior: EstadoFormularioBloqueio, fd: FormData): Promise<EstadoFormularioBloqueio> {
  const { entrada, valores } = lerFormularioBloqueio(fd, 'editar');
  const r = await editarBloqueio({ ...entrada, id: entrada.id });
  const rota = entrada.id ? ROTAS.bloqueio(entrada.id) : ROTAS.bloqueios;
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar(rota);
    const mensagem = r.erro === 'acesso_negado' ? MENSAGENS_BLOQUEIO.acessoNegado : MENSAGENS_BLOQUEIO.naoEncontrado;
    return { mensagem, erros: {}, valores, salvo: null };
  }
  if (r.dados.resultado === 'invalido') {
    return { mensagem: null, erros: r.dados.erros, valores, salvo: null };
  }
  revalidatePath(ROTAS.bloqueios);
  revalidatePath(rota);
  return { mensagem: null, erros: {}, valores, salvo: { periodo: r.dados.bloqueio.periodo, aviso: r.dados.aviso } };
}

/** "Remover" de cada item da lista (PRG): `?remocao=ok|nao_encontrado|negado`. */
export async function removerBloqueioAcao(fd: FormData): Promise<void> {
  const id = fd.get('id');
  const r = await removerBloqueio({ id: typeof id === 'string' ? id : undefined });
  if (!r.ok && r.erro === 'nao_autenticado') paraEntrar(ROTAS.bloqueios);
  const remocao = r.ok ? 'ok' : r.erro === 'acesso_negado' ? 'negado' : 'nao_encontrado';
  if (r.ok) revalidatePath(ROTAS.bloqueios);
  redirect(`${ROTAS.bloqueios}?remocao=${remocao}`);
}
