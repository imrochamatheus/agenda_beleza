// Núcleo de cancelar item e marcar status do item (D-030 RN-3/RN-6/RN-8/RN-9; D-050 §3.6, RN-20, RN-21,
// RN-28, RN-33). Uma transação READ COMMITTED: salão FOR SHARE → cliente FOR KEY SHARE → reserva FOR UPDATE →
// itens (UPDATE) → derivados da reserva → mensagem (outbox, sempre por último). Nenhuma dessas transições torna
// um item ocupante, por isso o profissional NÃO é travado (A-9, dba.md Q13). `enfileirarMensagens` só depois
// do commit.
import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import type { ResultadoRegistro } from '@/server/mensagens/tipos';
import type { StatusReserva } from '@/server/repos/tipos';
import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';

import {
  aplicarPolitica,
  DesfazerAlteracao,
  fecharAlteracao,
  itemTravado,
  localizarItem,
  paraMensagens,
  registrarEvento,
  sair,
} from './alteracao-comum';
import { decidirTransicao } from './status';
import type { DependenciasAlteracao, ResultadoStatusItem } from './tipos-alteracao';

type Recusado = Extract<ResultadoStatusItem, { resultado: 'recusado' }>;
type Ok = { resultado: 'ok'; status: StatusReserva; revisao: number; registros: ResultadoRegistro[] };

export async function alterarStatusDoItem(
  ctx: TenantContext,
  e: { reservaId: unknown; itemId: unknown; destino: unknown; permitidos: readonly StatusReserva[]; operacao: 'cancelar_item' | 'marcar_status_item' },
  agora: Date,
  deps: DependenciasAlteracao,
): Promise<ResultadoStatusItem> {
  const previa = await localizarItem(ctx, e.reservaId, e.itemId);
  await aplicarPolitica(ctx, 'cancelar', deps, agora);
  const base = { operacao: e.operacao, salaoId: ctx.salaoId, reservaId: previa.id, itemId: previa.item.id };
  const para = e.permitidos.find((p) => p === e.destino);
  if (para === undefined) {
    // Destino fora do que a operação aceita: recusado sem gravar (a máquina também recusaria).
    registrarEvento({ ...base, resultado: 'recusado', motivo: 'transicao_invalida' });
    return { resultado: 'recusado', motivo: 'transicao_invalida' };
  }

  let saida: Recusado | Ok;
  try {
    saida = await emTransacao(async (r) => {
      await r.saloes.travarParaLeitura(ctx);
      await deps.aposTravas?.();
      await r.reservasAlteracao.travarCliente(ctx, previa.clienteId);
      const atual = await r.reservasAlteracao.travarParaAlterar(ctx, previa.id);
      const itens = await r.reservasAlteracao.lerItens(ctx, atual.id);
      const item = itemTravado(ctx, itens, previa.item.id);

      const d = decidirTransicao({ de: item.status, para, inicio: item.inicio, fim: item.fim, agora });
      if (!d.ok) return sair<Recusado>({ resultado: 'recusado', motivo: d.motivo });

      // RN-28: só o cancelamento gera mensagem para a cliente e por isso sobe a revisão (antes de registrar).
      const cancelar = para === 'cancelado';
      const revisao = cancelar ? atual.revisao + 1 : atual.revisao;
      const n = await r.reservasAlteracao.atualizarStatusDosItens(ctx, atual.id, {
        itemIds: [item.id],
        de: [item.status],
        para,
        revisao: cancelar ? revisao : null,
        agora,
      });
      // Sob a trava da reserva nenhum outro escritor muda o item: 0 linhas é erro de programação.
      if (n !== 1) throw new Error('alterarStatusDoItem: item não atualizado sob a trava da reserva');
      const fecho = await fecharAlteracao(ctx, r, atual, {
        revisao,
        eventos: cancelar ? [{ tipo: 'cancelamento', reservaItemId: item.id }] : [],
        agora,
      });
      return { resultado: 'ok' as const, status: fecho.status, revisao, registros: fecho.registros };
    });
  } catch (err) {
    if (err instanceof DesfazerAlteracao) saida = err.saida as Recusado;
    else throw err;
  }

  if (saida.resultado === 'recusado') {
    registrarEvento({ ...base, para, resultado: 'recusado', motivo: saida.motivo });
    return saida;
  }
  await enfileirarMensagens(saida.registros, { enfileirar: deps.enfileirar });
  registrarEvento({ ...base, para, resultado: 'atualizada', revisao: saida.revisao, statusReserva: saida.status });
  return {
    resultado: 'atualizada',
    itemId: previa.item.id,
    status: para,
    statusReserva: saida.status,
    revisao: saida.revisao,
    mensagens: paraMensagens(saida.registros),
  };
}
