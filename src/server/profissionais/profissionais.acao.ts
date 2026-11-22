import { defineAcao } from '@/server/tenant/define-acao';

import * as servico from './servico';
import type {
  EntradaCriar,
  EntradaEditar,
  EntradaId,
  ResultadoDesativar,
  ResultadoEuTambemAtendo,
  ResultadoReativar,
  ResultadoSalvar,
} from './tipos';

// Ações autenticadas da gestão de profissionais (D-013 §3.5, D-16). Padrão para os próximos
// `*.acao.ts`: arquivo em src/server/<modulo>/, SEM 'use server' (a casca src/app/**/acoes.ts é que
// tem), toda exportação é produto de defineAcao, e o handler é fino e delega ao serviço. Capacidade
// `configurar` (RN-4): o bloqueio por estado do salão é da E6.4.

export const criarProfissional = defineAcao<EntradaCriar, ResultadoSalvar>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.criar(ctx, e),
);

export const editarProfissional = defineAcao<EntradaEditar, ResultadoSalvar>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e, { agora }) => servico.editar(ctx, e, agora),
);

export const desativarProfissional = defineAcao<EntradaId, ResultadoDesativar>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e, { agora }) => servico.desativar(ctx, e, agora),
);

export const reativarProfissional = defineAcao<EntradaId, ResultadoReativar>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.reativar(ctx, e),
);

export const euTambemAtendo = defineAcao<Record<string, never>, ResultadoEuTambemAtendo>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx) => servico.euTambemAtendo(ctx),
);
