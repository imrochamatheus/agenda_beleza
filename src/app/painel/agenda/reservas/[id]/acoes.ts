'use server';

import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import type { CodigoErro } from '@/server/tenant/erros';
import { MENSAGENS_ALTERACAO } from '@/server/reservas/tipos-alteracao';
import { cancelarReservaAcao, marcarStatusReservaAcao, remarcarReservaAcao } from '@/server/reservas/reservas-status.acao';

import { lerFormularioRemarcar, MENSAGEM_DA_RECUSA, paraEstadoRemarcar, resultadoPrgDeStatus } from './estado';
import type { EstadoCancelar, EstadoMarcar, EstadoRemarcar } from './estado';

// Casca Next do detalhe da reserva (D-030): só converte FormData → entrada e o resultado da ação (defineAcao,
// que lê o cookie) → estado ou redirect. Não acessa repositórios. `redirect` fora de try. Erros voltam na
// resposta do POST (sem JavaScript); o sucesso é PRG com `?resultado=`.

const texto = (fd: FormData, nome: string): string => {
  const v = fd.get(nome);
  return typeof v === 'string' ? v : '';
};

function paraEntrar(reservaId: string): never {
  redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(ROTAS.agendaReserva(reservaId))}`);
}

function mensagemDeErro(erro: CodigoErro): string {
  return erro === 'acesso_negado' ? MENSAGENS_ALTERACAO.acessoNegado : erro === 'nao_encontrado' ? MENSAGENS_ALTERACAO.naoEncontrado : MENSAGENS_ALTERACAO.generico;
}

export async function remarcarAcao(anterior: EstadoRemarcar, fd: FormData): Promise<EstadoRemarcar> {
  const { entrada, valores } = lerFormularioRemarcar(fd);
  const reservaId = String(entrada.reservaId);
  const r = await remarcarReservaAcao(entrada);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar(reservaId);
    return { ...anterior, valores, erros: {}, motivos: null, mensagem: mensagemDeErro(r.erro) };
  }
  if (r.dados.resultado === 'atualizada') redirect(`${ROTAS.agendaReserva(reservaId)}?resultado=remarcada`);
  return paraEstadoRemarcar(r.dados, valores);
}

export async function cancelarAcao(anterior: EstadoCancelar, fd: FormData): Promise<EstadoCancelar> {
  const reservaId = texto(fd, 'reservaId');
  const passo = texto(fd, 'passo');
  // Segundo passo sem diálogo: o primeiro POST só pede a confirmação; "Manter reserva" volta ao início.
  if (passo === 'confirmar') return { mensagem: null, confirmando: true };
  if (passo !== 'cancelar') return { mensagem: null, confirmando: false };
  const r = await cancelarReservaAcao({ reservaId });
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar(reservaId);
    return { ...anterior, confirmando: false, mensagem: mensagemDeErro(r.erro) };
  }
  if (r.dados.resultado === 'atualizada') redirect(`${ROTAS.agendaReserva(reservaId)}?resultado=${resultadoPrgDeStatus(r.dados)}`);
  return { confirmando: false, mensagem: MENSAGEM_DA_RECUSA(r.dados.motivo) };
}

export async function marcarAcao(anterior: EstadoMarcar, fd: FormData): Promise<EstadoMarcar> {
  const reservaId = texto(fd, 'reservaId');
  const r = await marcarStatusReservaAcao({ reservaId, para: texto(fd, 'para') });
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') paraEntrar(reservaId);
    return { ...anterior, mensagem: mensagemDeErro(r.erro) };
  }
  if (r.dados.resultado === 'atualizada') redirect(`${ROTAS.agendaReserva(reservaId)}?resultado=${resultadoPrgDeStatus(r.dados)}`);
  return { mensagem: MENSAGEM_DA_RECUSA(r.dados.motivo) };
}
