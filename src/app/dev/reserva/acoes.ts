'use server';

import type { EstadoReserva } from '@/app/(publico)/[slug]/estado';
import { lerFormulario, paraEstado } from '@/app/(publico)/[slug]/formulario';
import { vitrineHabilitada } from '@/server/env';
import { validarConsentimentoDaReserva } from '@/server/consentimento/validacao';
import { validarEntradaCliente } from '@/server/clientes/validacao';

import { demonstrarReserva } from './demonstracao';

// Ação de /dev/reserva (D-026 §8): só validação PURA e confirmação simulada; sem banco, sessão nem
// repositório. Desligada a vitrine, devolve o estado anterior sem processar.
export async function demonstrarReservaAcao(anterior: EstadoReserva, formData: FormData): Promise<EstadoReserva> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valores } = lerFormulario(formData);
  const r = demonstrarReserva(entrada, {
    cliente: validarEntradaCliente({ nome: entrada.nome, telefone: entrada.telefone }),
    aceites: validarConsentimentoDaReserva(entrada.aceites),
  });
  return paraEstado(r, valores, anterior.chave);
}
