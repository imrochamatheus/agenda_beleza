// Validação pura da entrada de `criarReserva` (D-025 §3.3, A-14, A-15). Nunca toca o banco. Erros de
// programação (`agora`, modo, encaixe no público, contexto de outro tipo) lançam; o resto é resultado.
import { validarEntradaCliente } from '@/server/clientes/validacao';
import { validarServicos } from '@/server/disponibilidade/validacao';
import { ehUuid } from '@/server/repos/ids';
import { exigirEscopo } from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';

import { MENSAGENS_RESERVA } from './tipos';
import type { EntradaCriarReserva, ErrosReserva, ModoReserva } from './tipos';

export type EntradaValidada = {
  ok: true;
  servicoIds: string[];
  profissionalId: string;
  inicio: Date;
  nome: string;
  telefoneE164: string;
  chave: string | null;
  modo: ModoReserva;
  /** Ids que não são UUID: indisponíveis sem consultar o banco (A-15). */
  idsMalformados: { profissional: boolean; servicos: boolean };
};

export function ehInstanteValido(v: unknown): v is Date {
  return v instanceof Date && Number.isFinite(v.getTime());
}

/** Instante em minuto cheio (segundos e milissegundos zero). */
function ehMinutoCheio(d: Date): boolean {
  return d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

export function validarEntradaReserva(
  e: EntradaCriarReserva,
  ctx: ContextoEscopado,
): EntradaValidada | { ok: false; erros: ErrosReserva } {
  if (!ehInstanteValido(e?.agora)) {
    throw new RangeError('agora deve ser uma Date válida');
  }
  exigirEscopo(ctx);
  const modo = e.modo ?? 'normal';
  if (modo !== 'normal' && modo !== 'encaixe') {
    throw new RangeError(`modo de reserva inválido: ${String(modo)}`);
  }
  if (modo === 'encaixe' && ctx.tipo !== 'tenant') {
    throw new RangeError('o encaixe só é aceito com contexto de equipe');
  }

  const erros: ErrosReserva = {};
  const cliente = validarEntradaCliente({ nome: e.cliente?.nome, telefone: e.cliente?.telefone });
  if (!cliente.ok) {
    Object.assign(erros, cliente.erros);
  }

  const lista = Array.isArray(e.servicoIds) ? (e.servicoIds as unknown[]) : [];
  const textos = lista.every((s) => typeof s === 'string') ? (lista as string[]).map((s) => s.toLowerCase()) : null;
  if (textos === null || validarServicos(textos) !== null) {
    erros.servicos = MENSAGENS_RESERVA.servicos;
  }

  if (!ehInstanteValido(e.inicio) || !ehMinutoCheio(e.inicio)) {
    erros.inicio = MENSAGENS_RESERVA.inicio;
  }

  const bruta = e.chaveRequisicao ?? null;
  if (bruta !== null && !ehUuid(bruta)) {
    erros.chave = MENSAGENS_RESERVA.chave;
  }

  if (!cliente.ok || Object.keys(erros).length > 0 || textos === null) {
    return { ok: false, erros };
  }
  return {
    ok: true,
    servicoIds: textos,
    profissionalId: typeof e.profissionalId === 'string' ? e.profissionalId.toLowerCase() : '',
    inicio: e.inicio,
    nome: cliente.nome,
    telefoneE164: cliente.telefoneE164,
    chave: bruta === null ? null : bruta.toLowerCase(),
    modo,
    idsMalformados: { profissional: !ehUuid(e.profissionalId), servicos: !textos.every((s) => ehUuid(s)) },
  };
}
