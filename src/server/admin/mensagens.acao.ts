import { defineAcaoAdmin } from '@/server/tenant/define-acao-admin';

import { reenviarMensagemAdmin } from './mensagens';

// Ação do super admin sobre a fila (D-045 RN-4): `defineAcaoAdmin` dá 401 sem sessão de admin e 403 para
// sessão de salão ou admin sem TOTP, no servidor, também em POST direto. Handler fino: a regra está em
// ./mensagens. O id vem do formulário e é validado como UUID lá; o salão é lido da própria mensagem.

export const reenviarMensagemAcao = defineAcaoAdmin(async (ctx, e: { mensagemId: unknown }, { agora }) =>
  reenviarMensagemAdmin(ctx, e.mensagemId, agora),
);
