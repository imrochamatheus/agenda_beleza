// Peças compartilhadas das operações por item (D-030; D-050 §3.6, T-6). Sem 'use server' e sem next/*.
import { politicaDeOperacao } from '@/server/assinatura/politica-operacao';
import { exigirPermissao } from '@/server/auth/permissoes';
import { registrarMensagem } from '@/server/mensagens/registrar';
import type { ResultadoRegistro } from '@/server/mensagens/tipos';
import type { Repos } from '@/server/repos';
import { repos } from '@/server/repos';
import { ehUuid } from '@/server/repos/ids';
import type { ReservaTravada } from '@/server/repos/reserva-alteracao';
import type { ItemDeReservaDTO, ReservaDTO, StatusReserva } from '@/server/repos/tipos';
import type { TenantContext } from '@/server/tenant/context';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';

import { derivarReserva } from './itens';
import type { DependenciasAlteracao } from './tipos-alteracao';

/** Sentinela: desfaz a transação e carrega o desfecho de negócio, capturada FORA dela (como a D-025). */
export class DesfazerAlteracao<S> extends Error {
  constructor(readonly saida: S) {
    super('alteração desfeita');
    this.name = 'DesfazerAlteracao';
  }
}

export function sair<S>(saida: S): never {
  throw new DesfazerAlteracao(saida);
}

const lerId = (v: unknown): string => {
  if (typeof v !== 'string' || !ehUuid(v.trim())) throw new NaoEncontrado();
  return v.trim().toLowerCase();
};

/** Reserva lida antes das travas (só para permissão e para saber o que travar). */
export type ReservaPrevia = { id: string; clienteId: string; itens: ItemDeReservaDTO[] };
export type ItemPrevio = ReservaPrevia & { item: ItemDeReservaDTO };

/**
 * RN-25: permissão geral, id de reserva ou de item malformado/inexistente/de outro salão (ou item de outra
 * reserva) = 404 uniforme, depois a permissão sobre o profissional DO ITEM (profissional em item alheio = 403).
 * Só leitura escopada ao salão; as travas vêm depois e a permissão é reconferida sob elas.
 */
export async function localizarItem(ctx: TenantContext, reservaId: unknown, itemId: unknown): Promise<ItemPrevio> {
  exigirPermissao(ctx, 'reserva.alterar');
  const rid = lerId(reservaId);
  const iid = lerId(itemId);
  const r = await repos().reservas.buscarPorId(ctx, rid);
  const item = r.itens.find((i) => i.id.toLowerCase() === iid);
  if (item === undefined) throw new NaoEncontrado();
  exigirPermissao(ctx, 'reserva.alterar', { profissionalId: item.profissionalId.toLowerCase() });
  return { ...previa(r), item };
}

/** "Cancelar todos" (A-14): operação `reserva.cancelar_todos` (só gestor) ANTES de ler; depois 404 uniforme. */
export async function localizarReservaParaCancelarTodos(ctx: TenantContext, reservaId: unknown): Promise<ReservaPrevia> {
  exigirPermissao(ctx, 'reserva.cancelar_todos');
  const r = await repos().reservas.buscarPorId(ctx, lerId(reservaId));
  return previa(r);
}

const previa = (r: ReservaDTO): ReservaPrevia => ({ id: r.id.toLowerCase(), clienteId: r.clienteId, itens: r.itens });

/** Reconfere, sob a trava da reserva, que o item existe e que o papel pode operá-lo (o item pode ter mudado). */
export function itemTravado(ctx: TenantContext, itens: readonly ItemDeReservaDTO[], itemId: string): ItemDeReservaDTO {
  const item = itens.find((i) => i.id.toLowerCase() === itemId.toLowerCase());
  if (item === undefined) throw new NaoEncontrado();
  exigirPermissao(ctx, 'reserva.alterar', { profissionalId: item.profissionalId.toLowerCase() });
  return item;
}

/** RN-25/D-038: a política negando é 403, antes de qualquer transação. */
export async function aplicarPolitica(ctx: TenantContext, capacidade: 'agendar' | 'cancelar', deps: DependenciasAlteracao, agora: Date): Promise<void> {
  const decisao = await (deps.politica ?? politicaDeOperacao)(ctx, capacidade, agora);
  if (!decisao.permitido) throw new AcessoNegado(decisao.motivo);
}

export function registrarEvento(dados: Record<string, unknown>): void {
  // Só ids e enumerados; nunca nome, telefone nem mensagem do banco.
  console.info(JSON.stringify({ evento: 'reserva.alterar', ...dados }));
}

export type EventoDeMensagem = { tipo: 'remarcacao' | 'cancelamento'; reservaItemId: string | null };

/**
 * Fecho comum, DENTRO da transação e depois do UPDATE dos itens (ordem: itens → reserva → mensagem):
 * 1. relê os itens e regrava os derivados da reserva por `derivarReserva` (R-2) com a revisão dada;
 * 2. registra as mensagens do evento (a revisão já foi gravada, RN-28);
 * 3. RN-33: se o status derivado PASSOU a `concluido`, registra o convite de avaliação (chave única: voltar a
 *    `concluido` nunca cria um segundo);
 * 4. RN-31: substitui as `pendente` da reserva que deixaram de ser vigentes (um UPDATE, `PREDICADO_VIGENTE`).
 */
export async function fecharAlteracao(
  ctx: TenantContext,
  r: Repos,
  atual: ReservaTravada,
  d: { revisao: number; eventos: readonly EventoDeMensagem[]; agora: Date },
): Promise<{ status: StatusReserva; itens: ItemDeReservaDTO[]; registros: ResultadoRegistro[] }> {
  const itens = await r.reservasAlteracao.lerItens(ctx, atual.id);
  const derivados = derivarReserva(itens, { status: atual.status, canceladaEm: atual.canceladaEm }, d.agora);
  await r.reservasAlteracao.gravarDerivados(ctx, atual.id, { ...derivados, revisao: d.revisao, agora: d.agora });

  const registros: ResultadoRegistro[] = [];
  for (const e of d.eventos) {
    registros.push(await registrarMensagem(ctx, { reservaId: atual.id, tipo: e.tipo, reservaItemId: e.reservaItemId }, d.agora, r));
  }
  if (derivados.status === 'concluido' && atual.status !== 'concluido') {
    registros.push(await registrarMensagem(ctx, { reservaId: atual.id, tipo: 'convite_avaliacao' }, d.agora, r));
  }
  await r.mensagens.substituirNaoVigentes(ctx, atual.id, d.agora);
  return { status: derivados.status, itens, registros };
}

export const paraMensagens = (registros: readonly ResultadoRegistro[]) =>
  registros.map((x) => ({ mensagemId: x.mensagemId, estado: x.estado }));
