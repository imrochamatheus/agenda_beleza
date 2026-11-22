import { defineAcao } from '@/server/tenant/define-acao';

import * as servico from './servico';
import type { EntradaConvidar, ResultadoConvidar } from './tipos';

// Ação autenticada do convite (D-039 §2). Serve também para reenviar. Capacidade `configurar` (RN-11):
// salão somente leitura (D-038) não convida. O aceite é pré-autenticação e não passa por aqui.

export const convidarProfissional = defineAcao<EntradaConvidar, ResultadoConvidar>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e, { agora }) => servico.convidar(ctx, e, agora),
);
