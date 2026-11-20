import { defineAcao } from '@/server/tenant/define-acao';

import * as servico from './perfil';
import type { EntradaPerfil, ResultadoSalvarPerfil } from './perfil-tipos';

// Ação autenticada do perfil público (D-020 §3.6, A-8). SEM 'use server' (a casca
// src/app/painel/configuracoes/perfil/acoes.ts é que tem); toda exportação é produto de defineAcao e o
// handler é fino. Só gestor (RN-1); capacidade `configurar` (RN-3): o bloqueio por estado é da E6.4.

export const salvarPerfilDoSalao = defineAcao<EntradaPerfil, ResultadoSalvarPerfil>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.salvarPerfil(ctx, e),
);
