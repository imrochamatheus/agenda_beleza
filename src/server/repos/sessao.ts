import type { Papel } from '@/server/tenant/context';

import { obterPrisma } from './db';

/**
 * Leitura de sessão para autenticação (D-005 §3.2). Exceção documentada à RN-8: é pré-contexto
 * (ainda não há salão), por isso recebe só o hash do token, nunca o token em claro nem um salaoId.
 */
export type SessaoValida = {
  usuarioId: string;
  papel: Papel;
  salaoId: string | null;
  profissionalId: string | null;
  totpVerificadoEm: Date | null;
};

/**
 * Sessão válida = `token_hash` igual, `expira_em > agora` (no limite, expirada) e não revogada.
 * `profissionalId` é o perfil vinculado ao usuário (UNIQUE (salao_id, usuario_id)), sem filtrar
 * `ativo` (o efeito de desativar sobre o login é da E1.2/E2.4).
 */
export async function buscarSessaoValida(
  tokenHash: string,
  agora: Date,
): Promise<SessaoValida | null> {
  const sessao = await obterPrisma().sessao.findFirst({
    where: { tokenHash, expiraEm: { gt: agora }, revogadaEm: null },
    select: {
      totpVerificadoEm: true,
      usuario: {
        select: { id: true, papel: true, salaoId: true, profissional: { select: { id: true } } },
      },
    },
  });
  if (!sessao) {
    return null;
  }
  const { usuario } = sessao;
  return {
    usuarioId: usuario.id,
    papel: usuario.papel,
    salaoId: usuario.salaoId,
    profissionalId: usuario.profissional?.id ?? null,
    totpVerificadoEm: sessao.totpVerificadoEm,
  };
}
