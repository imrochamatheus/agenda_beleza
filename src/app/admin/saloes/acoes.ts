'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { editarSalao, estenderTeste, reativarSalao, suspenderSalao } from '@/server/admin/saloes.acao';
import { MENSAGENS_ADMIN_SALOES as M } from '@/server/admin/saloes-tipos';
import { ehUuid } from '@/server/repos/ids';
import type { CodigoErro } from '@/server/tenant/erros';

import { lerEdicao, lerExtensao, lerSuspensao } from './estado';
import type { EstadoEdicao, EstadoExtensao, EstadoSuspensao } from './estado';

// Casca Next dos salões no painel do admin (D-044 §5): só converte FormData → entrada e o resultado da ação
// (defineAcaoAdmin, que lê o cookie `ab_admin`) → estado do formulário. NUNCA toca repositórios nem a sessão:
// a autorização é do servidor, também para um POST direto. O resultado volta no estado (sem PRG): funciona
// sem JavaScript. 401 volta para /admin/entrar (redirect fora de try); 403 e 404 viram mensagem.

function mensagemDeFalha(erro: CodigoErro): string {
  if (erro === 'nao_autenticado') redirect(ROTAS.adminEntrar);
  return erro === 'acesso_negado' ? M.acessoNegado : M.naoEncontrado;
}

function atualizar(salaoId: string): void {
  revalidatePath(ROTAS.adminSaloes);
  if (ehUuid(salaoId)) revalidatePath(ROTAS.adminSalao(salaoId));
}

/** "Salvar alterações": nome, endereço, fuso, regras da agenda e gestor. */
export async function editarSalaoAcao(_anterior: EstadoEdicao, fd: FormData): Promise<EstadoEdicao> {
  const { entrada, valores } = lerEdicao(fd);
  const r = await editarSalao(entrada);
  const base = { em: Date.now(), mensagem: null, resultado: null, valores };
  if (!r.ok) return { ...base, mensagem: mensagemDeFalha(r.erro) };
  if (r.dados.resultado === 'editado') atualizar(entrada.salaoId);
  return { ...base, resultado: r.dados };
}

/** Etapas `previa` e `confirmar` da suspensão (o campo oculto `etapa` decide). */
export async function suspenderSalaoAcao(_anterior: EstadoSuspensao, fd: FormData): Promise<EstadoSuspensao> {
  const { entrada, motivo } = lerSuspensao(fd);
  const r = await suspenderSalao(entrada);
  const base = { em: Date.now(), mensagem: null, resultado: null, valores: { motivo } };
  if (!r.ok) return { ...base, mensagem: mensagemDeFalha(r.erro) };
  if (r.dados.resultado === 'suspenso') atualizar(entrada.salaoId);
  return { ...base, resultado: r.dados };
}

/** Reativar (uma etapa só). */
export async function reativarSalaoAcao(_anterior: EstadoSuspensao, fd: FormData): Promise<EstadoSuspensao> {
  const { entrada, motivo } = lerSuspensao(fd);
  const r = await reativarSalao({ salaoId: entrada.salaoId, motivo: entrada.motivo });
  const base = { em: Date.now(), mensagem: null, resultado: null, valores: { motivo } };
  if (!r.ok) return { ...base, mensagem: mensagemDeFalha(r.erro) };
  if (r.dados.resultado === 'reativado') atualizar(entrada.salaoId);
  return { ...base, resultado: r.dados };
}

/** Etapas `previa` e `confirmar` da extensão do teste. */
export async function estenderTesteAcao(_anterior: EstadoExtensao, fd: FormData): Promise<EstadoExtensao> {
  const { entrada, dias } = lerExtensao(fd);
  const r = await estenderTeste(entrada);
  const base = { em: Date.now(), mensagem: null, resultado: null, valores: { dias } };
  if (!r.ok) return { ...base, mensagem: mensagemDeFalha(r.erro) };
  // Estendido, mudou e divergência alteram (ou podem ter alterado) o que a tela mostra.
  if (r.dados.resultado !== 'previa' && r.dados.resultado !== 'invalido' && r.dados.resultado !== 'recusado') atualizar(entrada.salaoId);
  return { ...base, resultado: r.dados };
}
