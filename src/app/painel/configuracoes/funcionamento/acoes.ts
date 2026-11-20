'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { salvarFuncionamentoDoSalao } from '@/server/salao/funcionamento.acao';
import { MENSAGENS_FUNCIONAMENTO as M } from '@/server/salao/funcionamento-tipos';

import { lerFormularioFuncionamento, valoresDoFuncionamento } from './estado';
import type { EstadoFuncionamento } from './estado';

// Casca Next de /painel/configuracoes/funcionamento (D-020 §3.8): só converte FormData → entrada e o
// resultado da ação → estado do formulário. Não acessa repositórios. `redirect` sempre fora de try. Sem
// PRG (A-9): o sucesso devolve o modo gravado e a semana canônica (ou linhas vazias com "não informar").

function paraEntrar(): never {
  redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(ROTAS.configuracoesFuncionamento)}`);
}

/** "Salvar horário". */
export async function salvarFuncionamentoAcao(_anterior: EstadoFuncionamento, fd: FormData): Promise<EstadoFuncionamento> {
  const { entrada, modo, valores } = lerFormularioFuncionamento(fd);
  const r = await salvarFuncionamentoDoSalao(entrada);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar();
    return { mensagem: r.erro === 'acesso_negado' ? M.acessoNegado : M.formulario, sucesso: null, erros: {}, modo, valores };
  }
  if (r.dados.resultado === 'invalido') {
    return { mensagem: null, sucesso: null, erros: r.dados.erros, modo, valores };
  }
  revalidatePath(ROTAS.configuracoesFuncionamento);
  const f = r.dados.funcionamento;
  return {
    mensagem: null,
    sucesso: M.salvo,
    erros: {},
    modo: f.definido ? 'informar' : 'nao_informar',
    valores: valoresDoFuncionamento(f),
    funcionamento: f,
  };
}
