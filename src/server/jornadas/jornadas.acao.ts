import { defineAcao } from '@/server/tenant/define-acao';

import * as servico from './servico';
import type { EntradaSalvarJornada, ResultadoSalvarJornada } from './tipos';

// Ação autenticada da jornada semanal (D-015 §3.5), no padrão da D-013/D-014: SEM 'use server' (a
// casca src/app/painel/profissionais/[id]/jornada/acoes.ts é que tem), toda exportação é produto de
// defineAcao e o handler é fino. Só o gestor edita (RN-1); capacidade `configurar` (RN-11): o
// bloqueio por estado do salão é da E6.4. A leitura não é ação (a página chama servico.obter).

export const salvarJornada = defineAcao<EntradaSalvarJornada, ResultadoSalvarJornada>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.salvar(ctx, e),
);
