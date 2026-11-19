import type { Papel, TenantContext } from '@/server/tenant/context';
import { exigirEscopo } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { obterPrisma } from './db';

/**
 * Usuário para o login (D-010 §3.6). Pré-contexto: busca pelo e-mail já normalizado. Exceção
 * documentada à RN-8 (como sessao.ts). Único DTO que expõe `senhaHash`; só o login.ts o consome.
 */
export type UsuarioParaLogin = {
  id: string;
  papel: Papel;
  senhaHash: string;
  emailConfirmado: boolean;
  /** `ativo` do perfil de profissional vinculado; null = sem perfil. */
  profissionalAtivo: boolean | null;
};

export async function buscarUsuarioParaLogin(email: string): Promise<UsuarioParaLogin | null> {
  const u = await obterPrisma().usuario.findUnique({
    where: { email },
    select: {
      id: true,
      papel: true,
      senhaHash: true,
      emailConfirmadoEm: true,
      profissional: { select: { ativo: true } },
    },
  });
  if (!u) {
    return null;
  }
  return {
    id: u.id,
    papel: u.papel,
    senhaHash: u.senhaHash,
    emailConfirmado: u.emailConfirmadoEm !== null,
    profissionalAtivo: u.profissional?.ativo ?? null,
  };
}

export type IdentidadePainel = { nomeUsuario: string; nomeSalao: string };

/**
 * Nome do usuário e do salão para o painel (RN-21). Escopada: filtra por `ctx.usuarioId` E pelo
 * salão do contexto; exige contexto de tenant. Ausente → NaoEncontrado.
 */
export async function buscarIdentidadeDoPainel(ctx: TenantContext): Promise<IdentidadePainel> {
  const salaoId = exigirEscopo(ctx);
  if ((ctx as { tipo?: unknown }).tipo !== 'tenant') {
    throw new Error('identidade do painel exige TenantContext');
  }
  const u = await obterPrisma().usuario.findFirst({
    where: { id: ctx.usuarioId, salaoId },
    select: { nome: true, salao: { select: { nome: true } } },
  });
  if (!u || !u.salao) {
    throw new NaoEncontrado();
  }
  return { nomeUsuario: u.nome, nomeSalao: u.salao.nome };
}
