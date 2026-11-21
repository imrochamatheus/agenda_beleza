import { defineAcaoAdmin } from '@/server/tenant/define-acao-admin';

import { arquivarDenuncias as arquivar, restaurarAvaliacao as restaurar, retirarAvaliacao as retirar } from './moderacao';
import type { EntradaModeracao } from './moderacao';

// Ações do super admin sobre avaliações (D-035, RN-11). Cada exportação é `defineAcaoAdmin`: 401 sem
// sessão de admin, 403 para qualquer sessão de salão ou admin sem TOTP, verificado no servidor.
// Handlers finos: a regra está em ./moderacao. Não existe ação de salão que edite ou apague avaliação.

export const retirarAvaliacao = defineAcaoAdmin(async (ctx, e: EntradaModeracao, { agora }) => retirar(ctx, e, agora));

export const restaurarAvaliacao = defineAcaoAdmin(async (ctx, e: EntradaModeracao) => restaurar(ctx, e));

export const arquivarDenuncias = defineAcaoAdmin(
  async (ctx, e: { avaliacaoId: string; denunciaId?: string }, { agora }) => arquivar(ctx, e, agora),
);
