// Conversão pura FormData ↔ serviço da reserva pública (D-026 §3): sem next/*, sem banco. A casca
// `'use server'` (acoes.ts) só chama estas funções e `redirect`.
import { ROTAS } from '@/config/navegacao';
import { lerConsentimentoDoFormulario, valoresDoFormulario } from '@/server/consentimento/formulario';
import { lerHorario, lerProfissional, lerServicoIds, montarHref, slugPlausivel } from '@/server/reserva-publica/passos';
import { MENSAGENS_RESERVA_PUBLICA } from '@/server/reserva-publica/tipos';
import type { EntradaReservaPublica, ResultadoReservaPublica } from '@/server/reserva-publica/tipos';

import type { EstadoReserva } from './estado';

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
const LIMITE_NOME = 100;
const LIMITE_TELEFONE = 30;

export function lerFormulario(fd: FormData, ip: string): { entrada: EntradaReservaPublica; valores: EstadoReserva['valores'] } {
  const nome = texto(fd.get('nome'));
  const telefone = texto(fd.get('telefone'));
  return {
    entrada: {
      slug: texto(fd.get('slug')),
      servicoIds: fd.getAll('s').filter((x): x is string => typeof x === 'string'),
      profissionalId: texto(fd.get('profissionalId')),
      inicio: texto(fd.get('inicio')),
      nome,
      telefone,
      aceites: lerConsentimentoDoFormulario(fd),
      chaveRequisicao: texto(fd.get('chave')),
      ip,
      tokenHumano: texto(fd.get('cf-turnstile-response')).slice(0, 2100) || null,
    },
    // Eco cortado nos tetos: não devolve entradas enormes.
    valores: { ...valoresDoFormulario(fd), nome: nome.slice(0, LIMITE_NOME), telefone: telefone.slice(0, LIMITE_TELEFONE) },
  };
}

/** Destino do redirecionamento (303) de `voltar` e `slug_mudou`; null quando o resultado fica na resposta. */
export function destinoDoRedirecionamento(fd: FormData, r: ResultadoReservaPublica): string | null {
  if (r.resultado !== 'voltar' && r.resultado !== 'slug_mudou') return null;
  const slug = r.resultado === 'slug_mudou' ? r.slugAtual : texto(fd.get('slug'));
  const base = slugPlausivel(slug) ? ROTAS.salaoPublico(slug) : ROTAS.inicio;
  const s = lerServicoIds(fd.getAll('s').filter((x): x is string => typeof x === 'string'));
  const p = lerProfissional(texto(fd.get('p')));
  const data = /^\d{4}-\d{2}-\d{2}$/.test(texto(fd.get('data'))) ? texto(fd.get('data')) : null;
  const h = lerHorario(texto(fd.get('inicio')));

  if (r.resultado === 'slug_mudou') {
    return montarHref(base, {
      ...(s && { s }),
      ...(s && p && { p }),
      ...(s && p && data && { data }),
      ...(s && p && data && h && { h: h.toISOString() }),
    });
  }
  const aviso = r.aviso;
  if (r.passo === 'servicos' || !s) return montarHref(base, { aviso });
  if (r.passo === 'profissional' || !p) return montarHref(base, { s, aviso });
  return montarHref(base, { s, p, ...(data && { data }), aviso });
}

/** Estado da resposta para os desfechos que não redirecionam. */
export function paraEstado(r: ResultadoReservaPublica, valores: EstadoReserva['valores'], chave: string): EstadoReserva {
  const base: EstadoReserva = { status: 'editando', mensagem: null, erros: {}, valores, chave, resumo: null, repetida: false };
  switch (r.resultado) {
    case 'confirmada':
      return { ...base, status: 'confirmada', resumo: r.resumo, repetida: r.repetida };
    case 'indisponivel':
      return { ...base, status: 'indisponivel' };
    case 'invalido': {
      const { nome, telefone, mensagensReserva } = r.erros;
      const geral = r.erros.servicos ?? r.erros.inicio ?? r.erros.chave ?? null;
      const campos = {
        ...(nome && { nome }),
        ...(telefone && { telefone }),
        ...(mensagensReserva && { mensagensReserva }),
      };
      return { ...base, erros: campos, mensagem: geral ?? (Object.keys(campos).length === 0 ? MENSAGENS_RESERVA_PUBLICA.generico : null) };
    }
    case 'recusado':
    case 'limitado':
      return { ...base, mensagem: r.mensagem };
    default:
      // `voltar` e `slug_mudou` redirecionam; chegar aqui é erro de programação.
      return { ...base, mensagem: MENSAGENS_RESERVA_PUBLICA.recusada };
  }
}
