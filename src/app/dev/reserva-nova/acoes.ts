'use server';

import { aplicarLinha, lerFormularioReservaManual, paraEstado } from '@/app/painel/agenda/nova/estado';
import type { EstadoReservaManual } from '@/app/painel/agenda/nova/estado';
import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';

import { demonstrarReservaManual } from './demonstracao';

// Ação de /dev/reserva-nova (D-029; D-050): só a lógica PURA (sem banco, sessão nem rede). Desligada a
// vitrine, devolve o estado anterior sem processar. "Registrar" aqui não grava nada; "Adicionar outro
// serviço"/"Remover" usam a mesma `aplicarLinha` da página real.
export async function demonstrarReservaManualAcao(anterior: EstadoReservaManual, fd: FormData): Promise<EstadoReservaManual> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valores, chave, linha } = lerFormularioReservaManual(fd);
  if (linha !== null) return aplicarLinha(valores, chave, linha);
  const r = demonstrarReservaManual(entrada, new Date());
  return paraEstado(r, valores, { chave, novaChave: crypto.randomUUID(), baseAgenda: ROTAS.devAgenda });
}
