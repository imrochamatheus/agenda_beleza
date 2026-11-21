'use server';

import { vitrineHabilitada } from '@/server/env';
import { lerConsentimentoDoFormulario, valoresDoFormulario } from '@/server/consentimento/formulario';
import { validarConsentimentoDaReserva } from '@/server/consentimento/validacao';

import type { EstadoConsentimento } from './estado';

// Ação de demonstração de /dev/consentimento (D-023 §3.7): só a validação PURA, sem banco, sessão nem
// repositório; nada é gravado. Desligada a vitrine, devolve o estado anterior sem processar.
export async function demonstrarConsentimentoAcao(anterior: EstadoConsentimento, fd: FormData): Promise<EstadoConsentimento> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const valores = valoresDoFormulario(fd);
  const v = validarConsentimentoDaReserva(lerConsentimentoDoFormulario(fd));
  if (!v.ok) return { erros: v.erros, valores, gravaria: null };
  return { erros: {}, valores, gravaria: v.finalidades };
}
