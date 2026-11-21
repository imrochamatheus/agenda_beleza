'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { PARAMETRO_DENUNCIA, VALOR_DENUNCIA_RECEBIDA } from '@/config/denuncia';
import { ROTAS } from '@/config/navegacao';
import { denunciarPorSlug } from '@/server/denuncias/denunciar';
import { configDaProtecao } from '@/server/protecao/config';
import { extrairIp } from '@/server/protecao/ip';

import { slugPlausivel } from '@/server/reserva-publica/passos';
import { reservarPelaPagina } from '@/server/reserva-publica/servico';

import type { EstadoReserva } from './estado';
import type { EstadoDenuncia } from './_denuncia/estado';
import { lerFormularioDenuncia, paraEstadoDenuncia } from './_denuncia/formulario';
import { destinoDoRedirecionamento, lerFormulario, paraEstado } from './formulario';

// Casca Next da reserva pública (D-026 §3): só converte FormData e resultados; nunca toca repositórios.
// `agora` = new Date() só aqui. `voltar` e `slug_mudou` redirecionam (303) para o GET do passo.
export async function reservarAcao(anterior: EstadoReserva, formData: FormData): Promise<EstadoReserva> {
  const ip = extrairIp(await headers(), configDaProtecao().proxyHops);
  const { entrada, valores } = lerFormulario(formData, ip);
  const resultado = await reservarPelaPagina(entrada, new Date());
  const destino = destinoDoRedirecionamento(formData, resultado);
  if (destino !== null) redirect(destino);
  return paraEstado(resultado, valores, anterior.chave);
}

// Denúncia de avaliação (D-035): `recebida` é PRG para a mesma página, com a resposta uniforme; só
// validação, verificação humana e limite voltam no estado. O slug do formulário só vira destino se for
// plausível (nunca redireciona para um valor arbitrário).
export async function denunciarAcao(_anterior: EstadoDenuncia, formData: FormData): Promise<EstadoDenuncia> {
  const ip = extrairIp(await headers(), configDaProtecao().proxyHops);
  const { slug, entrada, valores } = lerFormularioDenuncia(formData, ip);
  const resultado = await denunciarPorSlug(slug, entrada, new Date());
  if (resultado.resultado === 'recebida') {
    const base = slugPlausivel(slug) ? ROTAS.salaoPublico(slug) : '/';
    redirect(`${base}?${PARAMETRO_DENUNCIA}=${VALOR_DENUNCIA_RECEBIDA}#avaliacoes`);
  }
  return paraEstadoDenuncia(resultado, valores);
}
