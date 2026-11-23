import { defineAcao } from '@/server/tenant/define-acao';

import { criarReservaDaEquipe } from './reserva-equipe';
import type { ResultadoReservaEquipe } from './reserva-equipe';
import type { EntradaReservaEquipe } from './tipos';

// Ação autenticada da reserva manual da equipe (D-029; D-050 §3.11: N itens), no padrão das demais
// `*.acao.ts`: SEM 'use server' (a casca src/app/painel/agenda/nova/acoes.ts é que tem), toda exportação é
// produto de defineAcao e o handler é fino. Capacidade `agendar`: o salão suspenso recusa via
// `politicaPadraoDeReserva` (403, CA-13).

export const criarReservaManual = defineAcao<EntradaReservaEquipe, ResultadoReservaEquipe>(
  { papeis: ['gestor', 'profissional'], capacidade: 'agendar' },
  (ctx, e, { agora }) => criarReservaDaEquipe(ctx, e, agora),
);
