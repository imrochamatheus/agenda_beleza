'use server';

import { vitrineHabilitada } from '@/server/env';
import { validarCampos } from '@/server/avaliacoes/validacao';
import { MENSAGENS_AVALIACAO } from '@/server/avaliacoes/tipos';
import { lerFormulario } from '@/app/(publico)/[slug]/avaliar/[token]/formulario';
import type { EstadoAvaliacao } from '@/app/(publico)/[slug]/avaliar/[token]/estado';

// Ação de demonstração de /dev/avaliacao (D-032 §2): só a validação PURA, sem banco, sessão nem
// repositório; nada é gravado. Desligada a vitrine, devolve o estado anterior.
export async function demonstrarAvaliacaoAcao(anterior: EstadoAvaliacao, fd: FormData): Promise<EstadoAvaliacao> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valores } = lerFormulario(fd, 'desconhecido');
  const v = validarCampos(entrada);
  if (!v.ok) return { status: 'editando', mensagem: null, erros: v.erros, valores };
  return { status: 'enviada', mensagem: `${MENSAGENS_AVALIACAO.enviada} (demonstração: nada foi gravado)`, erros: {}, valores };
}
