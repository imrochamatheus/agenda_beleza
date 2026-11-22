'use server';

import type { EstadoAcaoAssinatura } from '@/app/painel/assinatura/estado';
import { mensagemDeCancelar } from '@/server/assinatura/cancelar-tipos';
import { mensagemDeIniciar } from '@/server/assinatura/iniciar-tipos';
import { mensagemDeRegularizar } from '@/server/assinatura/regularizar-tipos';
import { vitrineHabilitada } from '@/server/env';

// Ações de demonstração de /dev/assinatura (D-040, D-042): não chamam provedor, banco nem sessão; respondem
// sempre como se o provedor estivesse indisponível ("Erro de pagamento"). Desligada a vitrine, devolvem o
// estado anterior.

export async function demonstrarAssinarAcao(anterior: EstadoAcaoAssinatura): Promise<EstadoAcaoAssinatura> {
  if (!vitrineHabilitada(process.env)) return anterior;
  return { mensagem: mensagemDeIniciar({ resultado: 'provedor_indisponivel' }), variante: 'erro', em: Date.now() };
}

export async function demonstrarRegularizarAcao(anterior: EstadoAcaoAssinatura): Promise<EstadoAcaoAssinatura> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const m = mensagemDeRegularizar({ resultado: 'provedor_indisponivel' });
  return { mensagem: m.texto, variante: m.variante, em: Date.now() };
}

export async function demonstrarCancelarAcao(anterior: EstadoAcaoAssinatura): Promise<EstadoAcaoAssinatura> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const m = mensagemDeCancelar({ resultado: 'provedor_indisponivel' });
  return { mensagem: m.texto, variante: m.variante, em: Date.now() };
}
