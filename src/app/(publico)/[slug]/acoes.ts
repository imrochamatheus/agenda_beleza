'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { PARAMETRO_DENUNCIA, VALOR_DENUNCIA_RECEBIDA } from '@/config/denuncia';
import { ROTAS } from '@/config/navegacao';
import { denunciarPorSlug } from '@/server/denuncias/denunciar';
import { configDaProtecao } from '@/server/protecao/config';
import { extrairIp } from '@/server/protecao/ip';

import { slugPlausivel } from '@/server/reserva-publica/passos';
import { horariosParaReescolha, profissionalDoHorario } from '@/server/reserva-publica/reescolha';
import { reservarPelaPagina } from '@/server/reserva-publica/servico';
import { MENSAGENS_AVISO } from '@/server/reserva-publica/tipos';

import type { EstadoReserva } from './estado';
import type { EstadoDenuncia } from './_denuncia/estado';
import { lerFormularioDenuncia, paraEstadoDenuncia } from './_denuncia/formulario';
import { destinoDoRedirecionamento, lerFormulario, lerSelecaoDoFormulario, paraEstado } from './formulario';

// Casca Next da reserva pública (D-026 §3): só converte FormData e resultados; nunca toca repositórios.
// `agora` = new Date() só aqui. `voltar` e `slug_mudou` redirecionam (303) para o GET do passo.
export async function reservarAcao(anterior: EstadoReserva, formData: FormData): Promise<EstadoReserva> {
  const ip = extrairIp(await headers(), configDaProtecao().proxyHops);
  const { entrada, valores } = lerFormulario(formData, ip);
  const agora = new Date();
  const selecao = lerSelecaoDoFormulario(formData);
  // Reenvio depois de um conflito: o horário novo pode ser de outro profissional ("Sem preferência").
  if (formData.get('reescolha') === '1' && selecao) {
    const profissionalId = await profissionalDoHorario(entrada.slug, { ...selecao, h: entrada.inicio }, agora, ip);
    if (profissionalId !== null) entrada.profissionalId = profissionalId;
  }
  const resultado = await reservarPelaPagina(entrada, agora);
  // Horário tomado: NÃO redireciona (nome e telefone não vão para a URL). A resposta traz os horários
  // atualizados e os valores digitados, e o formulário continua no passo de reescolha (vale sem JavaScript).
  if (resultado.resultado === 'voltar' && resultado.passo === 'horario' && selecao) {
    const reescolha = await horariosParaReescolha(entrada.slug, selecao, agora, ip);
    if (reescolha !== null) {
      return {
        status: 'horario_indisponivel',
        mensagem: MENSAGENS_AVISO.horario_indisponivel,
        erros: {},
        valores,
        chave: anterior.chave,
        resumo: null,
        repetida: false,
        reescolha,
      };
    }
  }
  const destino = destinoDoRedirecionamento(formData, resultado);
  if (destino !== null) redirect(destino);
  const estado = paraEstado(resultado, valores, anterior.chave);
  // Erro de validação ou recusa durante a reescolha: continua mostrando os horários atualizados.
  // Recalculada (e não copiada de `anterior`): sem JavaScript o estado anterior não viaja no POST.
  if (formData.get('reescolha') === '1' && estado.status === 'editando' && selecao) {
    return { ...estado, reescolha: await horariosParaReescolha(entrada.slug, selecao, agora, ip) };
  }
  return estado;
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
