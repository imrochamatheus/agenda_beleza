// Conversão pura FormData ↔ serviço da denúncia (D-035). Sem next/*, sem banco.
import { CAMPOS_DENUNCIA } from '@/config/denuncia';
import { LIMITE_TEXTO_DENUNCIA, MENSAGENS_DENUNCIA } from '@/server/denuncias/tipos';
import type { EntradaDenuncia, ResultadoDenuncia } from '@/server/denuncias/tipos';

import type { EstadoDenuncia } from './estado';

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

export function lerFormularioDenuncia(
  fd: FormData,
  ip: string,
): { slug: string; entrada: EntradaDenuncia; valores: EstadoDenuncia['valores'] } {
  const motivo = texto(fd.get(CAMPOS_DENUNCIA.motivo)).slice(0, 40);
  // Teto generoso: o servidor recusa acima de 500; aqui só se evita eco gigante.
  const detalhe = texto(fd.get(CAMPOS_DENUNCIA.texto)).slice(0, LIMITE_TEXTO_DENUNCIA * 4);
  return {
    slug: texto(fd.get(CAMPOS_DENUNCIA.slug)).slice(0, 80),
    entrada: {
      avaliacaoId: texto(fd.get(CAMPOS_DENUNCIA.avaliacao)).slice(0, 80),
      motivo,
      texto: detalhe,
      ip,
      tokenHumano: texto(fd.get('cf-turnstile-response')).slice(0, 2100) || null,
    },
    valores: { motivo, texto: detalhe },
  };
}

/** `recebida` não chega aqui (a ação redireciona); qualquer outro resultado vira estado de erro. */
export function paraEstadoDenuncia(r: Exclude<ResultadoDenuncia, { resultado: 'recebida' }>, valores: EstadoDenuncia['valores']): EstadoDenuncia {
  switch (r.resultado) {
    case 'invalido':
      return { status: 'invalido', mensagem: null, erros: r.erros, valores };
    case 'humano':
      return { status: 'humano', mensagem: MENSAGENS_DENUNCIA.humano, erros: {}, valores };
    case 'limitado':
      return { status: 'limitado', mensagem: MENSAGENS_DENUNCIA.limitado, erros: {}, valores };
  }
}
