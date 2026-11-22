import { defineAcao } from '@/server/tenant/define-acao';

import { iniciarAssinatura as iniciar } from './iniciar';
import type { ResultadoIniciar } from './iniciar-tipos';

// Ação autenticada da assinatura (D-040 RN-2), no padrão das `*.acao.ts`: sem 'use server' (a casca
// está em src/app/painel/assinatura/acoes.ts), handler fino. Capacidade `assinatura`: permitida em
// qualquer estado em que a política a conceda (D-038). O retorno do checkout não é ação (é a página).

export const iniciarAssinatura = defineAcao<void, ResultadoIniciar>(
  { papeis: ['gestor'], capacidade: 'assinatura' },
  (ctx, _entrada, { agora }) => iniciar(ctx, agora),
);
