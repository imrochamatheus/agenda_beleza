'use server';

import { lerFormularioReservaManual, paraEstado } from '@/app/painel/agenda/nova/estado';
import type { EstadoReservaManual } from '@/app/painel/agenda/nova/estado';
import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';

import { demonstrarReservaManual } from './demonstracao';

// Ação de /dev/reserva-nova (D-029): só a lógica PURA (sem banco, sessão nem rede). Desligada a vitrine,
// devolve o estado anterior sem processar. "Registrar" aqui não grava nada.
export async function demonstrarReservaManualAcao(anterior: EstadoReservaManual, fd: FormData): Promise<EstadoReservaManual> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valores, chave } = lerFormularioReservaManual(fd);
  const r = demonstrarReservaManual(entrada, new Date());
  return paraEstado(r, valores, { chave, novaChave: crypto.randomUUID(), baseAgenda: ROTAS.devAgenda });
}
