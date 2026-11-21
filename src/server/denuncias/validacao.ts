import { lerPagina } from '@/server/clientes/validacao';
import { ehUuid } from '@/server/repos/ids';

import {
  ESTADOS_FILA,
  LIMITE_TEXTO_DENUNCIA,
  MENSAGENS_DENUNCIA,
  MENSAGENS_MODERACAO,
  MOTIVOS_DENUNCIA,
  MOTIVO_MODERACAO_MAX,
  MOTIVO_MODERACAO_MIN,
} from './tipos';
import type { ErrosDenuncia, EstadoFila, MotivoDenuncia } from './tipos';

// Validação pura das denúncias e da moderação (D-035). Sem next/*, sem banco; nunca lança.

export function ehMotivo(v: unknown): v is MotivoDenuncia {
  return typeof v === 'string' && (MOTIVOS_DENUNCIA as readonly string[]).includes(v);
}

/** Remove NUL, colapsa espaços e quebras e apara (o CHECK do banco exige texto == btrim(texto)). */
export function normalizarTexto(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replaceAll('\u0000', '').replace(/\s+/gu, ' ').trim();
}

const tamanho = (s: string): number => Array.from(s).length;

export type DenunciaValida = { motivo: MotivoDenuncia; texto: string | null };

/** Motivo da lista fechada; texto opcional de até 500 caracteres (vazio vira `null`, nunca ''). */
export function validarDenuncia(
  e: { motivo: unknown; texto?: unknown },
): { ok: true; dados: DenunciaValida } | { ok: false; erros: ErrosDenuncia } {
  const erros: ErrosDenuncia = {};
  if (!ehMotivo(e.motivo)) erros.motivo = MENSAGENS_DENUNCIA.motivo;
  const texto = normalizarTexto(e.texto);
  if (tamanho(texto) > LIMITE_TEXTO_DENUNCIA) erros.texto = MENSAGENS_DENUNCIA.texto;
  if (!ehMotivo(e.motivo) || Object.keys(erros).length > 0) return { ok: false, erros };
  return { ok: true, dados: { motivo: e.motivo, texto: texto === '' ? null : texto } };
}

const PADRAO_EMAIL = /[^\s@]+@[^\s@]+/u;
const PADRAO_TELEFONE = /\+?\d[\d\s().-]{5,}\d/gu;

/** Heurística: e-mail ou sequência de pelo menos 8 dígitos (telefone com separadores comuns). */
export function temDadoPessoalObvio(s: string): boolean {
  if (PADRAO_EMAIL.test(s)) return true;
  for (const trecho of s.match(PADRAO_TELEFONE) ?? []) {
    if (trecho.replace(/\D/gu, '').length >= 8) return true;
  }
  return false;
}

/** Motivo da moderação: obrigatório, 3 a 300 caracteres, sem e-mail nem telefone óbvios. */
export function validarMotivoModeracao(v: unknown): { ok: true; motivo: string } | { ok: false; erro: string } {
  const motivo = normalizarTexto(v);
  const n = tamanho(motivo);
  if (n < MOTIVO_MODERACAO_MIN || n > MOTIVO_MODERACAO_MAX) {
    return { ok: false, erro: MENSAGENS_MODERACAO.motivoObrigatorio };
  }
  if (temDadoPessoalObvio(motivo)) return { ok: false, erro: MENSAGENS_MODERACAO.motivoComDados };
  return { ok: true, motivo };
}

export type FiltrosFila = { salaoId: string | null; estado: EstadoFila | null; pagina: number };

const unico = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Filtros da fila lidos da query (GET): valor inválido vira "sem filtro"; página só `^[1-9]\d{0,6}$`. */
export function lerFiltrosDaFila(q: { salao?: unknown; estado?: unknown; pagina?: unknown }): FiltrosFila {
  const salao = unico(q.salao);
  const estado = unico(q.estado);
  return {
    salaoId: ehUuid(salao) ? salao.toLowerCase() : null,
    estado: typeof estado === 'string' && (ESTADOS_FILA as readonly string[]).includes(estado) ? (estado as EstadoFila) : null,
    pagina: lerPagina(unico(q.pagina)),
  };
}
