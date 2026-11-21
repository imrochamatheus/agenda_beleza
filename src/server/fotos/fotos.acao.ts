import { defineAcao } from '@/server/tenant/define-acao';

import * as servico from './servico';
import type {
  EntradaAlt,
  EntradaEnvio,
  EntradaMover,
  EntradaRemover,
  ResultadoAlt,
  ResultadoEnvio,
  ResultadoMover,
  ResultadoRemover,
} from './tipos';

// Ações autenticadas das fotos do salão (D-021 §3.4; A-4). SEM 'use server': a casca
// src/app/painel/configuracoes/fotos/acoes.ts tem; o envio entra pelo route handler (tratarEnvio).
// Toda exportação é produto de defineAcao; só gestor (RN-1); capacidade `configurar` (RN-3): o
// bloqueio por estado é da E6.4.

const CONFIG = { papeis: ['gestor'], capacidade: 'configurar' } as const;

/** A entrada é uma leitura ADIADA do corpo: só roda depois de sessão, papel e capacidade. */
export const enviarFoto = defineAcao<EntradaEnvio, ResultadoEnvio>(CONFIG, (ctx, e) => servico.enviar(ctx, e));
export const editarAltDaFoto = defineAcao<EntradaAlt, ResultadoAlt>(CONFIG, (ctx, e) => servico.editarAlt(ctx, e));
export const moverFoto = defineAcao<EntradaMover, ResultadoMover>(CONFIG, (ctx, e) => servico.mover(ctx, e));
export const removerFoto = defineAcao<EntradaRemover, ResultadoRemover>(CONFIG, (ctx, e) => servico.remover(ctx, e));
