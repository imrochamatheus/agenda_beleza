import { defineAcao } from '@/server/tenant/define-acao';

import { cancelarAssinatura as cancelar } from './cancelar';
import { lerEstadoVisto } from './cancelar-tipos';
import type { ResultadoCancelar } from './cancelar-tipos';
import { iniciarAssinatura as iniciar } from './iniciar';
import type { ResultadoIniciar } from './iniciar-tipos';
import { regularizarAssinatura as regularizar } from './regularizar';
import type { ResultadoRegularizar } from './regularizar-tipos';

// Ações autenticadas da assinatura (D-040 RN-2, D-042), no padrão das `*.acao.ts`: sem 'use server' (a
// casca está em src/app/painel/assinatura/acoes.ts), handlers finos. Capacidade `assinatura`: permitida
// em qualquer estado em que a política a conceda (D-038). O retorno do checkout não é ação (é a página).
// Nenhuma recebe id de assinatura: o alvo é sempre a do salão da sessão. `estadoVisto` é só dica de UX.

export const iniciarAssinatura = defineAcao<void, ResultadoIniciar>(
  { papeis: ['gestor'], capacidade: 'assinatura' },
  (ctx, _entrada, { agora }) => iniciar(ctx, agora),
);

export const cancelarAssinatura = defineAcao<{ estadoVisto?: string } | undefined, ResultadoCancelar>(
  { papeis: ['gestor'], capacidade: 'assinatura' },
  (ctx, entrada, { agora }) => {
    const estadoVisto = lerEstadoVisto(entrada?.estadoVisto);
    return cancelar(ctx, estadoVisto === undefined ? {} : { estadoVisto }, agora);
  },
);

export const regularizarAssinatura = defineAcao<void, ResultadoRegularizar>(
  { papeis: ['gestor'], capacidade: 'assinatura' },
  (ctx, _entrada, { agora }) => regularizar(ctx, agora),
);
