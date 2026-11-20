'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { salvarConfiguracoes, trocarSlugDoSalao } from '@/server/salao/configuracoes.acao';
import { MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';
import type { CodigoErro } from '@/server/tenant/erros';

import { lerFormularioRegras, lerFormularioSlug } from './estado';
import type { EstadoRegras, EstadoSlug } from './estado';

// Casca Next de /painel/configuracoes (D-017 §3.6): só converte FormData → entrada e o resultado da ação
// (defineAcao, que lê o cookie) → estado do formulário. Não acessa repositórios. `redirect` sempre fora
// de try. Sucesso e erro voltam no estado (sem PRG, D-23: funciona sem JavaScript, pois a página é
// renderizada na resposta do POST); o sucesso revalida o layout do painel (nome no cabeçalho).

function paraEntrar(): never {
  redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(ROTAS.configuracoes)}`);
}

const mensagemDeErro = (erro: Exclude<CodigoErro, 'nao_autenticado'>) => (erro === 'acesso_negado' ? M.acessoNegado : M.formulario);

/** "Salvar configurações". */
export async function salvarConfiguracoesAcao(_anterior: EstadoRegras, fd: FormData): Promise<EstadoRegras> {
  const { entrada, valores } = lerFormularioRegras(fd);
  const r = await salvarConfiguracoes(entrada);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar();
    return { mensagem: mensagemDeErro(r.erro), sucesso: null, erros: {}, valores };
  }
  if (r.dados.resultado === 'invalido') {
    return { mensagem: null, sucesso: null, erros: r.dados.erros, valores };
  }
  revalidatePath(ROTAS.painel, 'layout');
  return { mensagem: null, sucesso: M.regrasSalvas, erros: {}, valores: r.dados.valores };
}

/** "Trocar endereço". Depois de trocar (ou sem efeito), o campo volta vazio. */
export async function trocarSlugAcao(_anterior: EstadoSlug, fd: FormData): Promise<EstadoSlug> {
  const { entrada, valor } = lerFormularioSlug(fd);
  const r = await trocarSlugDoSalao(entrada);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar();
    return { mensagem: mensagemDeErro(r.erro), sucesso: null, erros: {}, valor };
  }
  if (r.dados.resultado === 'invalido') {
    return { mensagem: null, sucesso: null, erros: r.dados.erros, valor };
  }
  if (r.dados.resultado === 'trocado') {
    revalidatePath(ROTAS.painel, 'layout');
    return { mensagem: null, sucesso: M.slugTrocado, erros: {}, valor: '' };
  }
  return { mensagem: null, sucesso: M.slugSemEfeito, erros: {}, valor: '' };
}
