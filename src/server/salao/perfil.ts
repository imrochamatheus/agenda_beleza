import { exigirPermissao } from '@/server/auth/permissoes';
import { repos } from '@/server/repos';
import type { TenantContext } from '@/server/tenant/context';

import type { ResultadoSalvarPerfil, ValoresPerfil } from './perfil-tipos';
import { perfilParaColunas, validarPerfil, valoresDoPerfil } from './perfil-validacao';

// Serviço do perfil público do salão (D-020 §3.6; RN-1..RN-10). Sem next/*: as ações (perfil.acao.ts) e a
// página o chamam. Só o salão do contexto. Cada função começa por exigirPermissao (segunda barreira,
// depois de defineAcao). Gravar é um UPDATE só com as colunas do perfil (A-3): não toca nome, fuso,
// regras nem funcionamento; prevalece a última gravação (D-13).

/** Log estruturado de uma linha, só ids (nunca telefone, endereço ou descrição). */
function registrar(evento: string, dados: Record<string, unknown>): void {
  console.info(JSON.stringify({ evento, ...dados }));
}

/** Valores do formulário a partir do banco (página). */
export async function obterPerfil(ctx: TenantContext): Promise<{ valores: ValoresPerfil }> {
  exigirPermissao(ctx, 'salao.configurar');
  return { valores: valoresDoPerfil(await repos().saloes.obterPerfil(ctx)) };
}

/** Valida tudo antes de qualquer acesso; inválido → nada gravado; válido → um UPDATE. */
export async function salvarPerfil(ctx: TenantContext, e: unknown): Promise<ResultadoSalvarPerfil> {
  exigirPermissao(ctx, 'salao.configurar');
  const v = validarPerfil(e);
  if (!v.ok) {
    return { resultado: 'invalido', erros: v.erros };
  }
  const colunas = perfilParaColunas(v.perfil);
  await repos().saloes.atualizarPerfil(ctx, colunas);
  registrar('salao.perfil_salvo', { salaoId: ctx.salaoId });
  return { resultado: 'salvo', valores: valoresDoPerfil(colunas) };
}
