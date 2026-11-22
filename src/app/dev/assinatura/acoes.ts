'use server';

import type { EstadoAssinar } from '@/app/painel/assinatura/estado';
import { mensagemDeIniciar } from '@/server/assinatura/iniciar-tipos';
import { vitrineHabilitada } from '@/server/env';

// Ação de demonstração de /dev/assinatura (D-040): não chama provedor, banco nem sessão; responde
// sempre como se o provedor estivesse indisponível. Desligada a vitrine, devolve o estado anterior.

export async function demonstrarAssinarAcao(anterior: EstadoAssinar): Promise<EstadoAssinar> {
  if (!vitrineHabilitada(process.env)) return anterior;
  return { mensagem: mensagemDeIniciar({ resultado: 'provedor_indisponivel' }), sucesso: false };
}
