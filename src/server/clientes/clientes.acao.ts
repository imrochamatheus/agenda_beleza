import { defineAcao } from '@/server/tenant/define-acao';

import { anonimizarCliente as anonimizar } from './anonimizar';
import * as servico from './servico';
import type { EntradaAnonimizarCliente, EntradaEditarCliente, ResultadoAnonimizar, ResultadoEditarCliente } from './tipos';

// Ações autenticadas das clientes (D-022 §3.5), no padrão da D-013..D-021: SEM 'use server' (a casca
// src/app/painel/clientes/acoes.ts é que tem), toda exportação é produto de defineAcao e o handler é
// fino. O upsert NÃO é ação: é função de serviço chamada pelas ações de reserva (E3.2/E3.4/E4.2).
// Capacidade `configurar`: o bloqueio por suspensão do salão é da E6.4.

export const editarCliente = defineAcao<EntradaEditarCliente, ResultadoEditarCliente>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.editar(ctx, e),
);

/** D-031: anonimização (LGPD). Capacidade `lgpd`: permitida em qualquer estado do salão (CA-15). */
export const anonimizarCliente = defineAcao<EntradaAnonimizarCliente, ResultadoAnonimizar>(
  { papeis: ['gestor'], capacidade: 'lgpd' },
  (ctx, e, { agora }) => anonimizar(ctx, e, agora),
);
