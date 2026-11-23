'use server';

import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { cancelarItemAcao, cancelarTodosAcao, marcarStatusDoItemAcao, remarcarItemAcao } from '@/server/reservas/reservas-status.acao';
import { MENSAGENS_ALTERACAO } from '@/server/reservas/tipos-alteracao';

import { codigoPrgDeStatus, hrefDoResultado, lerFormularioRemarcar, mensagemDaRecusaDeStatus, mensagemDeErro, paraEstadoRemarcar } from './estado';
import type { EstadoCancelarTodos, EstadoDoItem, EstadoRemarcar } from './estado';

// Casca Next do detalhe da reserva (D-030; D-050 C2): só converte FormData → entrada e o resultado da ação
// (defineAcao, que lê o cookie) → estado ou redirect. Não acessa repositórios. `redirect` fora de try. Erros
// voltam na resposta do POST (sem JavaScript), com o `itemId` para a mensagem aparecer na parada certa; o
// sucesso é PRG com `?resultado=` + `#resultado`.

const texto = (fd: FormData, nome: string): string => {
  const v = fd.get(nome);
  return typeof v === 'string' ? v : '';
};

function paraEntrar(reservaId: string): never {
  redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(ROTAS.agendaReserva(reservaId))}`);
}

export async function remarcarAcao(_anterior: EstadoRemarcar, fd: FormData): Promise<EstadoRemarcar> {
  const { entrada, valores, itemId, de } = lerFormularioRemarcar(fd);
  const reservaId = String(entrada.reservaId);
  const r = await remarcarItemAcao(entrada);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar(reservaId);
    return { itemId, valores, erros: {}, motivos: null, mensagem: mensagemDeErro(r.erro) };
  }
  if (r.dados.resultado === 'atualizada') redirect(hrefDoResultado(ROTAS.agendaReserva(reservaId), { codigo: 'remarcado', itemId: r.dados.itemId, de }));
  return paraEstadoRemarcar(r.dados, itemId, valores);
}

export async function cancelarAcao(_anterior: EstadoDoItem, fd: FormData): Promise<EstadoDoItem> {
  const reservaId = texto(fd, 'reservaId');
  const itemId = texto(fd, 'itemId');
  const r = await cancelarItemAcao({ reservaId, itemId });
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar(reservaId);
    return { itemId, mensagem: mensagemDeErro(r.erro) };
  }
  if (r.dados.resultado === 'atualizada') redirect(hrefDoResultado(ROTAS.agendaReserva(reservaId), { codigo: 'cancelado', itemId: r.dados.itemId }));
  return { itemId, mensagem: mensagemDaRecusaDeStatus(r.dados.motivo) };
}

export async function marcarAcao(_anterior: EstadoDoItem, fd: FormData): Promise<EstadoDoItem> {
  const reservaId = texto(fd, 'reservaId');
  const itemId = texto(fd, 'itemId');
  const r = await marcarStatusDoItemAcao({ reservaId, itemId, destino: texto(fd, 'destino') });
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar(reservaId);
    return { itemId, mensagem: mensagemDeErro(r.erro) };
  }
  if (r.dados.resultado === 'atualizada') redirect(hrefDoResultado(ROTAS.agendaReserva(reservaId), { codigo: codigoPrgDeStatus(r.dados), itemId: r.dados.itemId }));
  return { itemId, mensagem: mensagemDaRecusaDeStatus(r.dados.motivo) };
}

export async function cancelarTodosDaReservaAcao(_anterior: EstadoCancelarTodos, fd: FormData): Promise<EstadoCancelarTodos> {
  const reservaId = texto(fd, 'reservaId');
  const r = await cancelarTodosAcao({ reservaId });
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar(reservaId);
    return { mensagem: mensagemDeErro(r.erro) };
  }
  if (r.dados.resultado === 'atualizada') redirect(hrefDoResultado(ROTAS.agendaReserva(reservaId), { codigo: 'todos_cancelados', n: r.dados.itemIds.length }));
  return { mensagem: MENSAGENS_ALTERACAO[r.dados.motivo] };
}
