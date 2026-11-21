'use server';

import { redirect } from 'next/navigation';

import { lerFormularioRemarcar, MENSAGEM_DA_RECUSA, paraEstadoRemarcar } from '@/app/painel/agenda/reservas/[id]/estado';
import type { EstadoCancelar, EstadoMarcar, EstadoRemarcar } from '@/app/painel/agenda/reservas/[id]/estado';
import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';

import { demonstrarRemarcar } from './demonstracao';

// Ações de /dev/reserva-acoes (D-030): só a lógica PURA (sem banco, sessão nem rede). Desligada a vitrine,
// devolvem o estado anterior sem processar. Nada é gravado; o sucesso é PRG para `?resultado=`.

const texto = (fd: FormData, nome: string): string => {
  const v = fd.get(nome);
  return typeof v === 'string' ? v : '';
};

export async function demonstrarRemarcarAcao(anterior: EstadoRemarcar, fd: FormData): Promise<EstadoRemarcar> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valores } = lerFormularioRemarcar(fd);
  const r = demonstrarRemarcar(entrada, new Date());
  if (r.resultado === 'atualizada') redirect(`${ROTAS.devReservaAcoes}?resultado=remarcada`);
  return paraEstadoRemarcar(r, valores);
}

export async function demonstrarCancelarAcao(anterior: EstadoCancelar, fd: FormData): Promise<EstadoCancelar> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const passo = texto(fd, 'passo');
  if (passo === 'confirmar') return { mensagem: null, confirmando: true };
  if (passo !== 'cancelar') return { mensagem: null, confirmando: false };
  redirect(`${ROTAS.devReservaAcoes}?resultado=cancelada`);
}

export async function demonstrarMarcarAcao(anterior: EstadoMarcar, fd: FormData): Promise<EstadoMarcar> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const para = texto(fd, 'para');
  if (para !== 'concluido' && para !== 'nao_compareceu') return { mensagem: MENSAGEM_DA_RECUSA('transicao_invalida') };
  redirect(`${ROTAS.devReservaAcoes}?resultado=${para === 'concluido' ? 'concluida' : 'nao_compareceu'}`);
}
