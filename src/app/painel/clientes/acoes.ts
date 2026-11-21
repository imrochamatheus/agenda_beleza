'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { anonimizarCliente, editarCliente } from '@/server/clientes/clientes.acao';
import { MENSAGENS_CLIENTE } from '@/server/clientes/tipos';

import { estadoInicial, lerFormularioCliente } from './estado';
import type { EstadoFormularioCliente } from './estado';

// Casca Next de /painel/clientes (D-022 §3.6): só converte FormData → entrada e o resultado da ação
// (defineAcao, que lê o cookie) → estado do formulário. Não acessa repositórios. `redirect` sempre fora
// de try. O resultado volta no estado (sem PRG, A-10): funciona sem JavaScript.

function paraEntrar(rota: string): never {
  redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(rota)}`);
}

/** "Salvar alterações" da cliente. */
export async function editarClienteAcao(_anterior: EstadoFormularioCliente, fd: FormData): Promise<EstadoFormularioCliente> {
  const { entrada, valores } = lerFormularioCliente(fd);
  const r = await editarCliente(entrada);
  const rota = entrada.id ? ROTAS.cliente(entrada.id) : ROTAS.clientes;
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar(rota);
    const mensagem = r.erro === 'acesso_negado' ? MENSAGENS_CLIENTE.acessoNegado : MENSAGENS_CLIENTE.naoEncontrado;
    return { ...estadoInicial(valores), mensagem };
  }
  const d = r.dados;
  if (d.resultado === 'invalido') {
    return { ...estadoInicial(valores), erros: d.erros };
  }
  if (d.resultado === 'recusado') {
    return { ...estadoInicial(valores), erros: { telefone: MENSAGENS_CLIENTE.telefoneEmUso }, existente: d.existente };
  }
  if (d.alterada) {
    revalidatePath(ROTAS.clientes);
    revalidatePath(rota);
  }
  return {
    ...estadoInicial({ nome: d.cliente.nome ?? '', telefone: d.cliente.telefoneFormatado ?? '' }),
    sucesso: d.alterada ? MENSAGENS_CLIENTE.salva : MENSAGENS_CLIENTE.semAlteracao,
  };
}

/** Códigos (lista fechada) de `?exclusao=` no detalhe, depois do PRG da exclusão. */
export type CodigoExclusao = 'ok' | 'ja_anonimizada' | 'negado';

/**
 * "Confirmar exclusão" (D-031): lê só o `clienteId`, chama a ação (gestor, capacidade `lgpd`) e termina
 * SEMPRE em redirect (PRG) ao detalhe com o código do resultado; nunca revela o motivo de um 404.
 */
export async function excluirClienteAcao(formData: FormData): Promise<void> {
  const bruto = formData.get('clienteId');
  const clienteId = typeof bruto === 'string' ? bruto : '';
  const rota = clienteId ? ROTAS.excluirCliente(clienteId) : ROTAS.clientes;
  const r = await anonimizarCliente({ clienteId });
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar(rota);
    if (r.erro === 'acesso_negado') redirect(`${ROTAS.cliente(clienteId)}?exclusao=negado`);
    redirect(ROTAS.clientes);
  }
  revalidatePath(ROTAS.clientes);
  revalidatePath(ROTAS.cliente(clienteId));
  redirect(`${ROTAS.cliente(clienteId)}?exclusao=${r.dados.resultado === 'anonimizada' ? 'ok' : 'ja_anonimizada'}`);
}
