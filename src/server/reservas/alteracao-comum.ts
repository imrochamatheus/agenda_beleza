// Peças compartilhadas de remarcar, cancelar e marcar status (D-030). Sem 'use server' e sem next/*.
import { exigirPermissao } from '@/server/auth/permissoes';
import { repos } from '@/server/repos';
import { ehUuid } from '@/server/repos/ids';
import type { TenantContext } from '@/server/tenant/context';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';
import { politicaDeOperacao } from '@/server/tenant/politica';

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

export type ReservaPrevia = { id: string; profissionalId: string; clienteId: string };

/**
 * RN-1: permissão geral, id malformado/inexistente/de outro salão = 404 uniforme, depois a permissão sobre o
 * profissional da reserva (profissional em reserva alheia = 403). Só leitura escopada ao salão; as travas vêm depois.
 */
export async function localizarReserva(ctx: TenantContext, reservaId: unknown): Promise<ReservaPrevia> {
  exigirPermissao(ctx, 'reserva.alterar');
  if (typeof reservaId !== 'string' || !ehUuid(reservaId)) throw new NaoEncontrado();
  const r = await repos().reservas.buscarPorId(ctx, reservaId);
  exigirPermissao(ctx, 'reserva.alterar', { profissionalId: r.profissionalId });
  return { id: r.id, profissionalId: r.profissionalId.toLowerCase(), clienteId: r.clienteId };
}

/** RN-2/CA-12: a política (gancho da E6.4) negando é 403, antes de qualquer transação. */
export async function aplicarPolitica(ctx: TenantContext, capacidade: 'agendar' | 'cancelar', deps: DependenciasAlteracao): Promise<void> {
  const decisao = await (deps.politica ?? politicaDeOperacao)(ctx, capacidade);
  if (!decisao.permitido) throw new AcessoNegado(decisao.motivo);
}

export function registrarEvento(dados: Record<string, unknown>): void {
  // Só ids e enumerados; nunca nome, telefone nem mensagem do banco.
  console.info(JSON.stringify({ evento: 'reserva.alterar', ...dados }));
}
