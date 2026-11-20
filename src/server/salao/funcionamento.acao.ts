import { defineAcao } from '@/server/tenant/define-acao';

import * as servico from './funcionamento';
import type { EntradaFuncionamento, ResultadoSalvarFuncionamento } from './funcionamento-tipos';

// Ação autenticada do horário de funcionamento (D-020 §3.6, A-8). SEM 'use server' (a casca
// src/app/painel/configuracoes/funcionamento/acoes.ts é que tem); toda exportação é produto de
// defineAcao e o handler é fino. Só gestor (RN-1); capacidade `configurar` (RN-3).

export const salvarFuncionamentoDoSalao = defineAcao<EntradaFuncionamento, ResultadoSalvarFuncionamento>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.salvarFuncionamento(ctx, e),
);
