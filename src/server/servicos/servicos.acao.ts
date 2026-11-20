import { defineAcao } from '@/server/tenant/define-acao';

import * as servico from './servico';
import type {
  EntradaCriarServico,
  EntradaEditarServico,
  EntradaIdServico,
  ResultadoSalvarServico,
  ResultadoSituacaoServico,
} from './tipos';

// Ações autenticadas da gestão de serviços (D-014 §3.5), no padrão da D-013: SEM 'use server' (a
// casca src/app/painel/servicos/acoes.ts é que tem), toda exportação é produto de defineAcao, e o
// handler é fino e delega ao serviço. Capacidade `configurar` (RN-5): o bloqueio por estado do salão
// é da E6.4.

export const criarServico = defineAcao<EntradaCriarServico, ResultadoSalvarServico>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.criar(ctx, e),
);

export const editarServico = defineAcao<EntradaEditarServico, ResultadoSalvarServico>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.editar(ctx, e),
);

export const desativarServico = defineAcao<EntradaIdServico, ResultadoSituacaoServico>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.desativar(ctx, e),
);

export const reativarServico = defineAcao<EntradaIdServico, ResultadoSituacaoServico>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.reativar(ctx, e),
);
