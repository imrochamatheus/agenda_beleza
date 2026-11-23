'use server';

import { redirect } from 'next/navigation';

import {
  DESTINOS,
  hrefDoResultado,
  lerFormularioRemarcar,
  mensagemDaRecusaDeStatus,
  paraEstadoRemarcar,
} from '@/app/painel/agenda/reservas/[id]/estado';
import type { EstadoCancelarTodos, EstadoDoItem, EstadoRemarcar } from '@/app/painel/agenda/reservas/[id]/estado';
import { vitrineHabilitada } from '@/server/env';
import { MENSAGENS_ALTERACAO } from '@/server/reservas/tipos-alteracao';

import { baseDaVista, demonstrarRemarcarItem, detalheDemo, vistaDoId } from './demonstracao';

// Ações de /dev/reserva-acoes (D-030; D-050): só a lógica PURA (sem banco, sessão nem rede). Desligada a
// vitrine, devolvem o estado anterior sem processar. Nada é gravado; o sucesso é PRG para `?resultado=` na
// mesma vista (a vista vem do id da reserva de exemplo).

const texto = (fd: FormData, nome: string): string => {
  const v = fd.get(nome);
  return typeof v === 'string' ? v : '';
};

export async function demonstrarRemarcarAcao(anterior: EstadoRemarcar, fd: FormData): Promise<EstadoRemarcar> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valores, itemId, de } = lerFormularioRemarcar(fd);
  const r = demonstrarRemarcarItem(entrada, new Date());
  if (r.resultado === 'atualizada') redirect(hrefDoResultado(baseDaVista(vistaDoId(entrada.reservaId)), { codigo: 'remarcado', itemId: r.itemId, de }));
  return paraEstadoRemarcar(r, itemId, valores);
}

/** Cancelar e marcar só aceitam itens da vista com a ação permitida agora (a mesma máquina do serviço). */
function itemDaVista(fd: FormData) {
  const vista = vistaDoId(texto(fd, 'reservaId'));
  const item = detalheDemo(vista, new Date()).itens.find((i) => i.id === texto(fd, 'itemId'));
  return { vista, item };
}

export async function demonstrarCancelarAcao(anterior: EstadoDoItem, fd: FormData): Promise<EstadoDoItem> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { vista, item } = itemDaVista(fd);
  if (!item?.acoes.cancelar) return { itemId: texto(fd, 'itemId'), mensagem: mensagemDaRecusaDeStatus('transicao_invalida') };
  redirect(hrefDoResultado(baseDaVista(vista), { codigo: 'cancelado', itemId: item.id }));
}

export async function demonstrarMarcarAcao(anterior: EstadoDoItem, fd: FormData): Promise<EstadoDoItem> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { vista, item } = itemDaVista(fd);
  const destino = texto(fd, 'destino');
  const permitido = destino === 'concluido' ? item?.acoes.concluir : destino === 'nao_compareceu' ? item?.acoes.naoCompareceu : false;
  if (!item || !permitido || !(DESTINOS as readonly string[]).includes(destino)) {
    return { itemId: texto(fd, 'itemId'), mensagem: mensagemDaRecusaDeStatus(item ? 'ainda_nao_iniciada' : 'transicao_invalida') };
  }
  redirect(hrefDoResultado(baseDaVista(vista), { codigo: destino as 'concluido' | 'nao_compareceu', itemId: item.id }));
}

export async function demonstrarCancelarTodosAcao(anterior: EstadoCancelarTodos, fd: FormData): Promise<EstadoCancelarTodos> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const vista = vistaDoId(texto(fd, 'reservaId'));
  const n = detalheDemo(vista, new Date()).itens.filter((i) => i.acoes.cancelar).length;
  if (n === 0) return { mensagem: MENSAGENS_ALTERACAO.nenhum_cancelavel };
  redirect(hrefDoResultado(baseDaVista(vista), { codigo: 'todos_cancelados', n }));
}
