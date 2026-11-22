import { defineAcaoAdmin } from '@/server/tenant/define-acao-admin';

import { editarSalao as editar, estenderTeste as estender, reativarSalao as reativar, suspenderSalao as suspender } from './saloes';
import type { EntradaEditarSalao, EntradaEstender, EntradaReativar, EntradaSuspender } from './saloes';

// Ações do super admin sobre salões (D-044, RN-1). Cada exportação é `defineAcaoAdmin`: 401 sem sessão de
// admin, 403 para qualquer sessão de salão ou admin sem TOTP, verificado no servidor (também em POST direto).
// Nenhuma passa pela política de operação de salão. Handlers finos: a regra está em ./saloes. A lista e o
// detalhe NÃO são ações: as páginas leem pelo serviço depois de `exigirAcessoAoAdmin`.

export const editarSalao = defineAcaoAdmin(async (ctx, e: EntradaEditarSalao, { agora }) => editar(ctx, e, agora));

export const suspenderSalao = defineAcaoAdmin(async (ctx, e: EntradaSuspender, { agora }) => suspender(ctx, e, agora));

export const reativarSalao = defineAcaoAdmin(async (ctx, e: EntradaReativar, { agora }) => reativar(ctx, e, agora));

export const estenderTeste = defineAcaoAdmin(async (ctx, e: EntradaEstender, { agora }) => estender(ctx, e, agora));
