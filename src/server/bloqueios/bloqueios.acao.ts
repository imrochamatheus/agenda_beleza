import { defineAcao } from '@/server/tenant/define-acao';

import * as servico from './servico';
import type {
  EntradaCriarBloqueio,
  EntradaEditarBloqueio,
  EntradaRemoverBloqueio,
  ResultadoRemoverBloqueio,
  ResultadoSalvarBloqueio,
} from './tipos';

// Ações autenticadas dos bloqueios (D-016 §3.6), no padrão da D-013..D-015: SEM 'use server' (a casca
// src/app/painel/bloqueios/acoes.ts é que tem), toda exportação é produto de defineAcao e o handler é
// fino. Gestor e profissional (o serviço aplica o escopo de cada um, RN-12); capacidade `configurar`
// (RN-17): o bloqueio por estado do salão é da E6.4. A leitura não é ação (as páginas chamam o serviço).

export const criarBloqueio = defineAcao<EntradaCriarBloqueio, ResultadoSalvarBloqueio>(
  { papeis: ['gestor', 'profissional'], capacidade: 'configurar' },
  (ctx, e, { agora }) => servico.criar(ctx, e, agora),
);

export const editarBloqueio = defineAcao<EntradaEditarBloqueio, ResultadoSalvarBloqueio>(
  { papeis: ['gestor', 'profissional'], capacidade: 'configurar' },
  (ctx, e, { agora }) => servico.editar(ctx, e, agora),
);

export const removerBloqueio = defineAcao<EntradaRemoverBloqueio, ResultadoRemoverBloqueio>(
  { papeis: ['gestor', 'profissional'], capacidade: 'configurar' },
  (ctx, e) => servico.remover(ctx, e),
);
