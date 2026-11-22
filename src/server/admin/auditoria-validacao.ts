import { FUSO_PADRAO } from '@/lib/format';
import { ehUuid } from '@/server/repos/ids';
import { ehDataCivilValida, intervaloDeDiasInteiros } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

import { CODIGOS_DE_ACAO, RESULTADOS_AUDITORIA } from './rotulos-admin';
import { MENSAGENS_AUDITORIA } from './auditoria-tipos';
import type { ErrosAuditoria, FiltrosAuditoria } from './auditoria-tipos';
import { lerPaginaAdmin, unico } from './paginacao';
import type { Consulta } from './paginacao';

// Filtros da auditoria (D-045 RN-12/RN-13/RN-15). Puro. Valor inválido nunca vira 500: lista fechada ou UUID
// inválidos são ignorados (`ignorados`); data ou período inválidos viram erro de campo e o período é ignorado.

const MAX_ATOR = 254;
/** E-mail "exato": sem espaço nem controle, uma arroba, com ponto no domínio. */
const FORMATO_EMAIL = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u;

/** Aceita 'AAAA-MM-DD' (campo date) ou 'dd/mm/aaaa'; data inexistente (31/02) → null. */
export function lerDataCivil(v: string): DataCivil | null {
  const t = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  let d: DataCivil | null = m ? { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) } : null;
  if (d === null) {
    m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
    d = m ? { ano: Number(m[3]), mes: Number(m[2]), dia: Number(m[1]) } : null;
  }
  return d !== null && ehDataCivilValida(d) ? d : null;
}

const doisDigitos = (n: number): string => String(n).padStart(2, '0');
export const paraTextoIso = (d: DataCivil): string => `${String(d.ano).padStart(4, '0')}-${doisDigitos(d.mes)}-${doisDigitos(d.dia)}`;

export function lerFiltrosAuditoria(sp: Consulta): {
  filtros: FiltrosAuditoria;
  erros: ErrosAuditoria;
  ignorados: boolean;
  ecoes: { ator: string; de: string; ate: string };
} {
  let ignorados = false;
  const erros: ErrosAuditoria = {};
  for (const k of ['salao', 'acao', 'resultado'] as const) {
    if (Array.isArray(sp[k])) ignorados = true;
  }

  const salaoBruto = unico(sp.salao)?.trim() ?? '';
  let salaoId: string | null = null;
  if (salaoBruto !== '') {
    if (ehUuid(salaoBruto)) salaoId = salaoBruto.toLowerCase();
    else ignorados = true;
  }

  const acaoBruta = unico(sp.acao) ?? '';
  let acao: string | null = null;
  if (acaoBruta !== '') {
    if ((CODIGOS_DE_ACAO as readonly string[]).includes(acaoBruta)) acao = acaoBruta;
    else ignorados = true;
  }

  const resBruto = unico(sp.resultado) ?? '';
  let resultado: 'sucesso' | 'falha' | null = null;
  if (resBruto !== '') {
    if ((RESULTADOS_AUDITORIA as readonly string[]).includes(resBruto)) resultado = resBruto as 'sucesso' | 'falha';
    else ignorados = true;
  }

  const atorBruto = (unico(sp.ator) ?? '').trim().slice(0, MAX_ATOR);
  let ator: string | null = null;
  if (atorBruto !== '') {
    if (FORMATO_EMAIL.test(atorBruto)) ator = atorBruto.toLowerCase();
    else erros.ator = MENSAGENS_AUDITORIA.atorInvalido;
  }

  const deBruto = (unico(sp.de) ?? '').trim().slice(0, 20);
  const ateBruto = (unico(sp.ate) ?? '').trim().slice(0, 20);
  let de: DataCivil | null = null;
  let ate: DataCivil | null = null;
  if (deBruto !== '') {
    de = lerDataCivil(deBruto);
    if (de === null) erros.de = MENSAGENS_AUDITORIA.dataInvalida;
  }
  if (ateBruto !== '') {
    ate = lerDataCivil(ateBruto);
    if (ate === null) erros.ate = MENSAGENS_AUDITORIA.dataInvalida;
  }
  if (de !== null && ate !== null && paraTextoIso(de) > paraTextoIso(ate)) {
    erros.de = MENSAGENS_AUDITORIA.periodoInvertido;
    de = null;
    ate = null;
  }

  return {
    filtros: {
      salaoId,
      ator,
      acao,
      resultado,
      de: de === null ? null : paraTextoIso(de),
      ate: ate === null ? null : paraTextoIso(ate),
      pagina: lerPaginaAdmin(unico(sp.pagina)),
    },
    erros,
    ignorados,
    ecoes: { ator: atorBruto, de: de === null ? deBruto : paraTextoIso(de), ate: ate === null ? ateBruto : paraTextoIso(ate) },
  };
}

/**
 * Período em instantes UTC meio-abertos [inicio, fim) pelos dias civis de `America/Sao_Paulo` (`fuso.ts`,
 * nunca `Date` local): `de` inclusivo 00:00, `ate` inclusivo até 23:59:59,999. Cada lado é independente.
 */
export function intervaloDoPeriodo(de: string | null, ate: string | null): { de: Date | null; ate: Date | null } {
  const dc = (t: string): DataCivil => ({ ano: Number(t.slice(0, 4)), mes: Number(t.slice(5, 7)), dia: Number(t.slice(8, 10)) });
  return {
    de: de === null ? null : intervaloDeDiasInteiros(dc(de), dc(de), FUSO_PADRAO).inicio,
    ate: ate === null ? null : intervaloDeDiasInteiros(dc(ate), dc(ate), FUSO_PADRAO).fim,
  };
}

/** Query string da auditoria preservando os filtros válidos. */
export function hrefDaAuditoria(base: string, f: FiltrosAuditoria, pagina: number): string {
  const p = new URLSearchParams();
  if (f.salaoId !== null) p.set('salao', f.salaoId);
  if (f.ator !== null) p.set('ator', f.ator);
  if (f.acao !== null) p.set('acao', f.acao);
  if (f.resultado !== null) p.set('resultado', f.resultado);
  if (f.de !== null) p.set('de', f.de);
  if (f.ate !== null) p.set('ate', f.ate);
  if (pagina > 1) p.set('pagina', String(pagina));
  const q = p.toString();
  return q === '' ? base : `${base}${base.includes('?') ? '&' : '?'}${q}`;
}

export const haFiltroNaAuditoria = (f: FiltrosAuditoria): boolean =>
  f.salaoId !== null || f.ator !== null || f.acao !== null || f.resultado !== null || f.de !== null || f.ate !== null;
