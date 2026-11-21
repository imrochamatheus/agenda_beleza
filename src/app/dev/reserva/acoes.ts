'use server';

import type { EstadoReserva } from '@/app/(publico)/[slug]/estado';
import { lerFormulario, paraEstado } from '@/app/(publico)/[slug]/formulario';
import { selecionarTurnstile } from '@/server/integrations/registry';
import { MENSAGENS_PROTECAO } from '@/server/protecao/tipos';
import { verificarHumano } from '@/server/protecao/turnstile';
import { vitrineHabilitada } from '@/server/env';
import { validarConsentimentoDaReserva } from '@/server/consentimento/validacao';
import { validarEntradaCliente } from '@/server/clientes/validacao';

import { demonstrarReserva } from './demonstracao';

// Ação de /dev/reserva (D-026 §8): só validação PURA e confirmação simulada; sem banco, sessão nem
// repositório. Desligada a vitrine, devolve o estado anterior sem processar.
export async function demonstrarReservaAcao(anterior: EstadoReserva, formData: FormData): Promise<EstadoReserva> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valores } = lerFormulario(formData, 'desconhecido');
  // A vitrine roda sem banco nem ambiente completo: usa sempre a porta SIMULADA (o resto do Turnstile é o
  // mesmo código da página real). Só o limite e a gravação ficam de fora.
  if (!(await verificarHumano(entrada.tokenHumano, entrada.ip, selecionarTurnstile({ modo: 'simulado' })))) {
    return paraEstado({ resultado: 'recusado', mensagem: MENSAGENS_PROTECAO.humano }, valores, anterior.chave);
  }
  const r = demonstrarReserva(entrada, {
    cliente: validarEntradaCliente({ nome: entrada.nome, telefone: entrada.telefone }),
    aceites: validarConsentimentoDaReserva(entrada.aceites),
  });
  return paraEstado(r, valores, anterior.chave);
}
