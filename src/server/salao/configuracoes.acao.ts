import { defineAcao } from '@/server/tenant/define-acao';

import * as servico from './configuracoes';
import type { EntradaRegras, EntradaSlug, ResultadoSalvarRegras, ResultadoTrocarSlug } from './tipos';

// Ações autenticadas das configurações do salão (D-017 §3.5). SEM 'use server' (a casca
// src/app/painel/configuracoes/acoes.ts é que tem); toda exportação é produto de defineAcao e o handler
// é fino. Só gestor (RN-7); capacidade `configurar` (RN-6): o bloqueio por estado do salão é da E6.4.

export const salvarConfiguracoes = defineAcao<EntradaRegras, ResultadoSalvarRegras>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.salvarRegras(ctx, e),
);

export const trocarSlugDoSalao = defineAcao<EntradaSlug, ResultadoTrocarSlug>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.trocarSlug(ctx, e),
);
