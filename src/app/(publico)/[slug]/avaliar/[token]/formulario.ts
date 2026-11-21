// Conversão pura FormData ↔ serviço da avaliação (D-032). Sem next/*, sem banco.
import { CAMPOS_AVALIACAO } from '@/config/avaliacao';
import { ehAceite } from '@/server/consentimento/validacao';
import { LIMITE_COMENTARIO, MENSAGEM_LINK_INVALIDO, MENSAGENS_AVALIACAO } from '@/server/avaliacoes/tipos';
import type { EntradaEnvio, ResultadoEnvio } from '@/server/avaliacoes/tipos';

import type { EstadoAvaliacao } from './estado';

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

export function lerFormulario(fd: FormData, ip: string): { entrada: EntradaEnvio; valores: EstadoAvaliacao['valores'] } {
  const nota = texto(fd.get(CAMPOS_AVALIACAO.nota));
  const comentario = texto(fd.get(CAMPOS_AVALIACAO.comentario));
  const aceite = fd.get(CAMPOS_AVALIACAO.aceite);
  return {
    entrada: {
      slug: texto(fd.get(CAMPOS_AVALIACAO.slug)),
      token: texto(fd.get(CAMPOS_AVALIACAO.token)),
      nota,
      // Teto generoso: o servidor recusa acima de 1000 caracteres; aqui só se evita eco gigante.
      comentario: comentario.slice(0, LIMITE_COMENTARIO * 4),
      aceite: typeof aceite === 'string' ? aceite : null,
      ip,
      tokenHumano: texto(fd.get('cf-turnstile-response')).slice(0, 2100) || null,
    },
    valores: { nota: nota.slice(0, 2), comentario: comentario.slice(0, LIMITE_COMENTARIO * 4), aceite: ehAceite(aceite) },
  };
}

export function paraEstado(r: ResultadoEnvio, valores: EstadoAvaliacao['valores']): EstadoAvaliacao {
  const base: EstadoAvaliacao = { status: 'editando', mensagem: null, erros: {}, valores };
  switch (r.resultado) {
    case 'enviada':
      return { ...base, status: 'enviada', mensagem: MENSAGENS_AVALIACAO.enviada, valores: { nota: '', comentario: '', aceite: false } };
    case 'invalido_campos':
      return { ...base, erros: r.erros };
    case 'link_invalido':
      return { ...base, status: 'invalido', mensagem: MENSAGEM_LINK_INVALIDO };
    case 'limite_excedido':
      return { ...base, status: 'limitado', mensagem: MENSAGENS_AVALIACAO.limitado };
    case 'verificacao_falhou':
      return { ...base, mensagem: MENSAGENS_AVALIACAO.humano };
  }
}
