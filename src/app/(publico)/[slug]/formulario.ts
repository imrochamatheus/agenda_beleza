// Conversão pura FormData ↔ serviço da reserva pública (D-026 §3; D-050 §3.10): sem next/*, sem banco. A casca
// `'use server'` (acoes.ts) só chama estas funções, `reescolhaDosItens` e `redirect`.
import { ROTAS } from '@/config/navegacao';
import { formatarHora, formatarLista } from '@/lib/format';
import { lerConsentimentoDoFormulario, valoresDoFormulario } from '@/server/consentimento/formulario';
import { MENSAGENS_PROTECAO } from '@/server/protecao/tipos';
import { lerItem, lerSelecao, lerServicoIds, montarHref, slugPlausivel, valorDoItem } from '@/server/reserva-publica/passos';
import type { ParametrosBrutos } from '@/server/reserva-publica/passos';
import type { SelecaoDaReescolha } from '@/server/reserva-publica/reescolha';
import { MENSAGENS_PASSO, MENSAGENS_RESERVA_PUBLICA } from '@/server/reserva-publica/tipos';
import type {
  EntradaReservaPublica,
  ReescolhaDosItens,
  ResultadoReservaPublica,
} from '@/server/reserva-publica/tipos';

import type { EstadoReserva, ReescolhaNoEstado } from './estado';

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
const LIMITE_NOME = 100;
const LIMITE_TELEFONE = 30;
/** Teto de índices lidos de `reabrir` (o fluxo tem no máximo 10 serviços). */
const LIMITE_REABRIR = 10;

/** Campos de texto do FormData como parâmetros brutos (arquivos ignorados; repetidos viram lista). */
export function parametrosDoFormulario(fd: FormData): ParametrosBrutos {
  const saida: Record<string, string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== 'string') continue;
    (saida[k] ??= []).push(v);
  }
  return Object.fromEntries(Object.entries(saida).map(([k, v]) => [k, v.length === 1 ? v[0] : v]));
}

/**
 * Entrada do serviço a partir do POST: `s` (ordem de escolha) e um item por serviço lido de `h<k>`
 * (`<profissionalId>_<isoUTC>`). Um `h<k>` ausente ou malformado vira item com campos vazios: o serviço o
 * recusa como inválido (nunca 500).
 */
export function lerFormulario(fd: FormData, ip: string): { entrada: EntradaReservaPublica; valores: EstadoReserva['valores'] } {
  const nome = texto(fd.get('nome'));
  const telefone = texto(fd.get('telefone'));
  const servicoIds = fd.getAll('s').filter((x): x is string => typeof x === 'string');
  const params = parametrosDoFormulario(fd);
  const itens = servicoIds.map((servicoId, k) => {
    const item = lerItem(params[`h${k}`]);
    return { servicoId, profissionalId: item?.profissionalId ?? '', inicio: item?.inicio.toISOString() ?? '' };
  });
  return {
    entrada: {
      slug: texto(fd.get('slug')),
      servicoIds,
      itens,
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

/** Índices dos itens que estavam abertos na reescolha (`reabrir`, repetido); inválidos e repetidos ignorados. */
export function lerReabrir(fd: FormData): number[] {
  const indices = fd
    .getAll('reabrir')
    .filter((x): x is string => typeof x === 'string' && /^(0|[1-9])$/.test(x))
    .map(Number);
  return [...new Set(indices)].slice(0, LIMITE_REABRIR);
}

/** Seleção completa do POST (s, data e todos os `h<k>` válidos) no formato de `reescolhaDosItens`; senão null. */
export function selecaoDaReescolha(fd: FormData): SelecaoDaReescolha | null {
  const sel = lerSelecao(parametrosDoFormulario(fd));
  if (sel === null) return null;
  return {
    s: sel.s,
    data: sel.data,
    itens: sel.itens.map((x) => ({ profissionalId: x.profissionalId, inicio: x.inicio.toISOString() })),
  };
}

/**
 * Destino do redirecionamento (303) de `voltar` e `slug_mudou`; null quando o resultado fica na resposta.
 * Campos adulterados degradam para o passo anterior; slug implausível vai ao início.
 */
export function destinoDoRedirecionamento(fd: FormData, r: ResultadoReservaPublica): string | null {
  if (r.resultado !== 'voltar' && r.resultado !== 'slug_mudou') return null;
  const slug = r.resultado === 'slug_mudou' ? r.slugAtual : texto(fd.get('slug'));
  const base = slugPlausivel(slug) ? ROTAS.salaoPublico(slug) : ROTAS.inicio;
  const params = parametrosDoFormulario(fd);
  const s = lerServicoIds(params.s);
  const sel = lerSelecao(params);
  const valores = sel?.itens.map((x) => valorDoItem(x.profissionalId, x.inicio)) ?? [];

  if (r.resultado === 'slug_mudou') {
    if (s === null) return base;
    return sel === null ? montarHref(base, { s }) : montarHref(base, { s, data: sel.data, h: valores });
  }
  const aviso = r.aviso;
  if (r.passo === 'servicos' || s === null) return montarHref(base, { aviso });
  if (sel === null) return montarHref(base, { s, aviso });
  // O passo do índice abre pelo primeiro `h` ausente: o item dele sai da URL.
  const h = valores.map((v, k) => (k === r.indice ? null : v));
  return montarHref(base, { s, data: sel.data, h, aviso });
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
      const geral = r.erros.itens ?? r.erros.chave ?? null;
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
      // `voltar` e `slug_mudou` redirecionam e `reescolher` vira reescolha; chegar aqui é erro de programação.
      return { ...base, mensagem: MENSAGENS_RESERVA_PUBLICA.recusada };
  }
}

/**
 * Texto do aviso da reescolha (web-design §5.6): nomeia o serviço e o horário que caíram (e com quem, se um
 * só). Itens apenas reabertos (`caiu: false`) não entram; null se nenhum caiu.
 */
export function mensagemDaReescolha(r: ReescolhaNoEstado): string | null {
  const caidos = r.itens.filter((i) => i.caiu);
  const hora = (iso: string) => formatarHora(new Date(iso), r.fuso);
  if (caidos.length === 0) return null;
  if (caidos.length === 1) {
    const [i] = caidos;
    return MENSAGENS_PASSO.reescolhaUm(hora(i.horarioAnteriorIso), i.servicoNome, i.profissionalAnteriorNome);
  }
  return MENSAGENS_PASSO.reescolhaVarios(formatarLista(caidos.map((i) => `${i.servicoNome} (${hora(i.horarioAnteriorIso)})`)));
}

/**
 * Estado da resposta depois de `reescolhaDosItens` (CA-10). `base` é o estado já montado para o desfecho
 * (valores, chave e, no reenvio com erro de campo, os erros): a reescolha só acrescenta a grade dos itens.
 */
export function comReescolha(base: EstadoReserva, r: ReescolhaDosItens): EstadoReserva {
  if (r.resultado === 'limitado') return { ...base, status: 'editando', mensagem: MENSAGENS_PROTECAO.limitado, reescolha: null };
  if (r.resultado === 'sem_queda') {
    return { ...base, status: 'editando', mensagem: base.mensagem ?? MENSAGENS_PASSO.reescolhaSemQueda, reescolha: null };
  }
  const aviso = mensagemDaReescolha(r);
  return aviso === null
    ? { ...base, reescolha: r }
    : { ...base, status: 'horario_indisponivel', mensagem: aviso, reescolha: r };
}
