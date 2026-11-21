'use server';

import { redirect } from 'next/navigation';

import { reservarPelaPagina } from '@/server/reserva-publica/servico';

import type { EstadoReserva } from './estado';
import { destinoDoRedirecionamento, lerFormulario, paraEstado } from './formulario';

// Casca Next da reserva pública (D-026 §3): só converte FormData e resultados; nunca toca repositórios.
// `agora` = new Date() só aqui. `voltar` e `slug_mudou` redirecionam (303) para o GET do passo.
export async function reservarAcao(anterior: EstadoReserva, formData: FormData): Promise<EstadoReserva> {
  const { entrada, valores } = lerFormulario(formData);
  const resultado = await reservarPelaPagina(entrada, new Date());
  const destino = destinoDoRedirecionamento(formData, resultado);
  if (destino !== null) redirect(destino);
  return paraEstado(resultado, valores, anterior.chave);
}
