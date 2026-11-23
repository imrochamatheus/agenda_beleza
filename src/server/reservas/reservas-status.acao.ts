import { defineAcao } from '@/server/tenant/define-acao';

import { cancelarItem } from './cancelar';
import { cancelarTodos } from './cancelar-todos';
import { marcarStatusDoItem } from './marcar-status';
import { remarcarItem } from './remarcar';
import type {
  EntradaCancelarTodos,
  EntradaItem,
  EntradaMarcarStatusItem,
  EntradaRemarcarItem,
  ResultadoCancelarTodos,
  ResultadoRemarcarItem,
  ResultadoStatusItem,
} from './tipos-alteracao';

// Ações autenticadas das operações POR ITEM (D-030; D-050 §3.6), no padrão das demais `*.acao.ts`: SEM
// 'use server' (a casca src/app/painel/agenda/reservas/[id]/acoes.ts é que tem), toda exportação é produto de
// defineAcao e o handler é fino. Remarcar = capacidade `agendar`; cancelar item, cancelar todos e marcar status
// = `cancelar` (o salão suspenso ainda cancela e notifica, D-038). "Cancelar todos" exige ainda a operação
// `reserva.cancelar_todos` (só gestor, A-14), checada no serviço: o profissional recebe 403 antes de qualquer leitura.

export const remarcarItemAcao = defineAcao<EntradaRemarcarItem, ResultadoRemarcarItem>(
  { papeis: ['gestor', 'profissional'], capacidade: 'agendar' },
  (ctx, e, { agora }) => remarcarItem(ctx, e, agora),
);

export const cancelarItemAcao = defineAcao<EntradaItem, ResultadoStatusItem>(
  { papeis: ['gestor', 'profissional'], capacidade: 'cancelar' },
  (ctx, e, { agora }) => cancelarItem(ctx, e, agora),
);

export const marcarStatusDoItemAcao = defineAcao<EntradaMarcarStatusItem, ResultadoStatusItem>(
  { papeis: ['gestor', 'profissional'], capacidade: 'cancelar' },
  (ctx, e, { agora }) => marcarStatusDoItem(ctx, e, agora),
);

export const cancelarTodosAcao = defineAcao<EntradaCancelarTodos, ResultadoCancelarTodos>(
  { papeis: ['gestor', 'profissional'], capacidade: 'cancelar' },
  (ctx, e, { agora }) => cancelarTodos(ctx, e, agora),
);
