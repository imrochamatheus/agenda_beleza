'use server';

import { headers } from 'next/headers';

import { enviarAvaliacao } from '@/server/avaliacoes/servico';
import { configDaProtecao } from '@/server/protecao/config';
import { extrairIp } from '@/server/protecao/ip';

import type { EstadoAvaliacao } from './estado';
import { lerFormulario, paraEstado } from './formulario';

// Casca Next do envio da avaliação (D-032 §2): só converte FormData e resultados; nunca toca
// repositórios. `agora` = new Date() só aqui. Sem redirect: o estado da ação traz o resultado, também
// sem JavaScript.
export async function avaliarAcao(_anterior: EstadoAvaliacao, formData: FormData): Promise<EstadoAvaliacao> {
  const ip = extrairIp(await headers(), configDaProtecao().proxyHops);
  const { entrada, valores } = lerFormulario(formData, ip);
  return paraEstado(await enviarAvaliacao(entrada, new Date()), valores);
}
