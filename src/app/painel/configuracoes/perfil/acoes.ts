'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { salvarPerfilDoSalao } from '@/server/salao/perfil.acao';
import { MENSAGENS_PERFIL as M } from '@/server/salao/perfil-tipos';

import { lerFormularioPerfil } from './estado';
import type { EstadoPerfil } from './estado';

// Casca Next de /painel/configuracoes/perfil (D-020 §3.8): só converte FormData → entrada e o resultado da
// ação (defineAcao, que lê o cookie) → estado do formulário. Não acessa repositórios. `redirect` sempre
// fora de try. Sucesso e erro voltam no estado (sem PRG, A-9: funciona sem JavaScript, pois a página é
// renderizada na resposta do POST); o sucesso devolve os valores normalizados do servidor.

function paraEntrar(): never {
  redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(ROTAS.configuracoesPerfil)}`);
}

/** "Salvar perfil". */
export async function salvarPerfilAcao(_anterior: EstadoPerfil, fd: FormData): Promise<EstadoPerfil> {
  const { entrada, valores } = lerFormularioPerfil(fd);
  const r = await salvarPerfilDoSalao(entrada);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar();
    return { mensagem: r.erro === 'acesso_negado' ? M.acessoNegado : M.formulario, sucesso: null, erros: {}, valores };
  }
  if (r.dados.resultado === 'invalido') {
    return { mensagem: null, sucesso: null, erros: r.dados.erros, valores };
  }
  revalidatePath(ROTAS.configuracoesPerfil);
  return { mensagem: null, sucesso: M.salvo, erros: {}, valores: r.dados.valores };
}
