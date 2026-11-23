// "Cancelar todos" (D-050 RN-24, A-14, DA-11): só o gestor (operação `reserva.cancelar_todos`). Numa transação
// cancela todos os itens `confirmado` com `agora < fim`; concluídos, não compareceu e já terminados ficam como
// estão; nenhum cancelável → `nenhum_cancelavel` sem gravar. Um UPDATE (todos com a mesma `revisao + 1`), os
// derivados, UM `cancelamento` SEM item (RN-29) e o convite se o derivado virou `concluido` (CA-28, RN-33).
// Ordem de travas igual à de cancelar item (sem profissional: A-9). Fila só depois do commit.
import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import type { ResultadoRegistro } from '@/server/mensagens/tipos';
import type { StatusReserva } from '@/server/repos/tipos';
import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';

import {
  aplicarPolitica,
  DesfazerAlteracao,
  fecharAlteracao,
  localizarReservaParaCancelarTodos,
  paraMensagens,
  registrarEvento,
  sair,
} from './alteracao-comum';
import { itensCancelaveis } from './status';
import type { DependenciasAlteracao, EntradaCancelarTodos, ResultadoCancelarTodos } from './tipos-alteracao';

type Recusado = Extract<ResultadoCancelarTodos, { resultado: 'recusado' }>;
type Ok = { resultado: 'ok'; itemIds: string[]; status: StatusReserva; revisao: number; registros: ResultadoRegistro[] };

export async function cancelarTodos(
  ctx: TenantContext,
  e: EntradaCancelarTodos,
  agora: Date,
  deps: DependenciasAlteracao = {},
): Promise<ResultadoCancelarTodos> {
  const previa = await localizarReservaParaCancelarTodos(ctx, e.reservaId);
  await aplicarPolitica(ctx, 'cancelar', deps, agora);
  const base = { operacao: 'cancelar_todos', salaoId: ctx.salaoId, reservaId: previa.id };

  let saida: Recusado | Ok;
  try {
    saida = await emTransacao(async (r) => {
      await r.saloes.travarParaLeitura(ctx);
      await deps.aposTravas?.();
      await r.reservasAlteracao.travarCliente(ctx, previa.clienteId);
      const atual = await r.reservasAlteracao.travarParaAlterar(ctx, previa.id);
      const alvos = itensCancelaveis(await r.reservasAlteracao.lerItens(ctx, atual.id), agora);
      if (alvos.length === 0) return sair<Recusado>({ resultado: 'recusado', motivo: 'nenhum_cancelavel' });

      const revisao = atual.revisao + 1;
      const n = await r.reservasAlteracao.atualizarStatusDosItens(ctx, atual.id, {
        itemIds: alvos.map((i) => i.id),
        de: ['confirmado'],
        para: 'cancelado',
        revisao,
        agora,
      });
      if (n !== alvos.length) throw new Error('cancelarTodos: itens não atualizados sob a trava da reserva');
      const fecho = await fecharAlteracao(ctx, r, atual, { revisao, eventos: [{ tipo: 'cancelamento', reservaItemId: null }], agora });
      return { resultado: 'ok' as const, itemIds: alvos.map((i) => i.id), status: fecho.status, revisao, registros: fecho.registros };
    });
  } catch (err) {
    if (err instanceof DesfazerAlteracao) saida = err.saida as Recusado;
    else throw err;
  }

  if (saida.resultado === 'recusado') {
    registrarEvento({ ...base, resultado: 'recusado', motivo: saida.motivo });
    return saida;
  }
  await enfileirarMensagens(saida.registros, { enfileirar: deps.enfileirar });
  registrarEvento({ ...base, resultado: 'atualizada', itens: saida.itemIds.length, revisao: saida.revisao, statusReserva: saida.status });
  return {
    resultado: 'atualizada',
    itemIds: saida.itemIds,
    revisao: saida.revisao,
    statusReserva: saida.status,
    mensagens: paraMensagens(saida.registros),
  };
}
