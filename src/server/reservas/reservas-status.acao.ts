import { defineAcao } from '@/server/tenant/define-acao';

import { cancelarReserva } from './cancelar';
import { marcarStatusReserva } from './marcar-status';
import { remarcarReserva } from './remarcar';
import type {
  EntradaCancelar,
  EntradaMarcarStatus,
  EntradaRemarcar,
  ResultadoRemarcar,
  ResultadoStatus,
} from './tipos-alteracao';

// Ações autenticadas de alterar a reserva (D-030), no padrão das demais `*.acao.ts`: SEM 'use server' (a casca
// src/app/painel/agenda/reservas/[id]/acoes.ts é que tem), toda exportação é produto de defineAcao e o handler é
// fino. Remarcar = capacidade `agendar`; cancelar e marcar status = `cancelar` (o salão suspenso ainda cancela, E6.4).

export const remarcarReservaAcao = defineAcao<EntradaRemarcar, ResultadoRemarcar>(
  { papeis: ['gestor', 'profissional'], capacidade: 'agendar' },
  (ctx, e, { agora }) => remarcarReserva(ctx, e, agora),
);

export const cancelarReservaAcao = defineAcao<EntradaCancelar, ResultadoStatus>(
  { papeis: ['gestor', 'profissional'], capacidade: 'cancelar' },
  (ctx, e, { agora }) => cancelarReserva(ctx, e, agora),
);

export const marcarStatusReservaAcao = defineAcao<EntradaMarcarStatus, ResultadoStatus>(
  { papeis: ['gestor', 'profissional'], capacidade: 'cancelar' },
  (ctx, e, { agora }) => marcarStatusReserva(ctx, e, agora),
);
