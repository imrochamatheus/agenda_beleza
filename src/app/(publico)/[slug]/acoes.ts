'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { PARAMETRO_DENUNCIA, VALOR_DENUNCIA_RECEBIDA } from '@/config/denuncia';
import { ROTAS } from '@/config/navegacao';
import { denunciarPorSlug } from '@/server/denuncias/denunciar';
import { configDaProtecao } from '@/server/protecao/config';
import { extrairIp } from '@/server/protecao/ip';

import { slugPlausivel } from '@/server/reserva-publica/passos';
import { reescolhaDosItens } from '@/server/reserva-publica/reescolha';
import { reservarPelaPagina } from '@/server/reserva-publica/servico';

import { estadoInicialReserva } from './estado';
import type { EstadoReserva } from './estado';
import type { EstadoDenuncia } from './_denuncia/estado';
import { lerFormularioDenuncia, paraEstadoDenuncia } from './_denuncia/formulario';
import {
  comReescolha,
  destinoDoRedirecionamento,
  lerFormulario,
  lerReabrir,
  paraEstado,
  selecaoDaReescolha,
} from './formulario';

// Casca Next da reserva pública (D-026 §3; D-050 §3.10): só converte FormData e resultados; nunca toca
// repositórios. `agora` = new Date() só aqui. `voltar` e `slug_mudou` redirecionam (303) para o GET do passo.
export async function reservarAcao(anterior: EstadoReserva, formData: FormData): Promise<EstadoReserva> {
  const ip = extrairIp(await headers(), configDaProtecao().proxyHops);
  const { entrada, valores } = lerFormulario(formData, ip);
  const agora = new Date();
  const reabrir = lerReabrir(formData);
  const resultado = await reservarPelaPagina(entrada, agora);

  // Horário de algum item tomado (CA-10): NÃO redireciona (nome e telefone não vão para a URL). A resposta
  // aponta o item que caiu, com os horários atualizados dele, e preserva os demais itens e os valores
  // digitados (vale sem JavaScript: o estado da ação assume a página).
  if (resultado.resultado === 'reescolher') {
    const selecao = selecaoDaReescolha(formData);
    const reescolha = selecao === null ? null : await reescolhaDosItens(entrada.slug, selecao, agora, ip, { reabrir });
    if (reescolha === null) {
      redirect(destinoDoRedirecionamento(formData, { resultado: 'voltar', passo: 'servicos', aviso: 'servico_indisponivel' })!);
    }
    return comReescolha({ ...estadoInicialReserva(anterior.chave), valores }, reescolha);
  }

  const destino = destinoDoRedirecionamento(formData, resultado);
  if (destino !== null) redirect(destino);
  const estado = paraEstado(resultado, valores, anterior.chave);
  // Erro de validação ou recusa durante a reescolha: os itens que estavam abertos continuam com a grade.
  // Recalculada (e não copiada de `anterior`): sem JavaScript o estado anterior não viaja no POST.
  if (reabrir.length > 0 && estado.status === 'editando') {
    const selecao = selecaoDaReescolha(formData);
    const reescolha = selecao === null ? null : await reescolhaDosItens(entrada.slug, selecao, agora, ip, { reabrir });
    if (reescolha?.resultado === 'reescolher') return comReescolha(estado, reescolha);
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
