// Validação pura da entrada de `criarReserva` (D-025 §3.3, A-14, A-15; D-050 §3.5 passo 1: N itens). Nunca toca o banco. Erros de
// programação (`agora`, modo, encaixe no público, contexto de outro tipo) lançam; o resto é resultado.
import { validarEntradaCliente } from '@/server/clientes/validacao';
import { validarServicos } from '@/server/disponibilidade/validacao';
import { ehUuid } from '@/server/repos/ids';
import { exigirEscopo } from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';

import { MENSAGENS_RESERVA } from './tipos';
import type { EntradaCriarReserva, ErrosReserva, ItemPedido, ModoReserva } from './tipos';

export type EntradaValidada = {
  ok: true;
  /** Na ordem pedida (a posição é a `ordem` gravada); ids em minúsculas. */
  itens: ItemPedido[];
  nome: string;
  telefoneE164: string;
  chave: string | null;
  modo: ModoReserva;
  /**
   * Ids que não são UUID: indisponíveis sem consultar o banco (A-15). `servicos` = algum serviço malformado;
   * `profissionais` = índices dos itens com profissional malformado.
   */
  malformados: { servicos: boolean; profissionais: number[] };
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

  // D-050 §3.5 passo 1: 1..10 itens, `servicoId` distintos (validarServicos), `inicio` em minuto cheio.
  const lista = Array.isArray(e.itens) ? (e.itens as unknown[]) : [];
  const objetos = lista.every((i) => typeof i === 'object' && i !== null && typeof (i as ItemPedido).servicoId === 'string');
  const servicoIds = objetos ? (lista as ItemPedido[]).map((i) => i.servicoId.toLowerCase()) : null;
  if (servicoIds === null || validarServicos(servicoIds) !== null) {
    erros.itens = MENSAGENS_RESERVA.servicos;
  }
  if (objetos) {
    (lista as ItemPedido[]).forEach((i, k) => {
      if (!ehInstanteValido(i.inicio) || !ehMinutoCheio(i.inicio)) {
        erros.porItem = { ...erros.porItem, [k]: { inicio: MENSAGENS_RESERVA.inicio } };
      }
    });
  }

  const bruta = e.chaveRequisicao ?? null;
  if (bruta !== null && !ehUuid(bruta)) {
    erros.chave = MENSAGENS_RESERVA.chave;
  }

  if (!cliente.ok || Object.keys(erros).length > 0 || servicoIds === null) {
    return { ok: false, erros };
  }
  const pedidos = lista as ItemPedido[];
  const itens = pedidos.map((i, k) => ({
    servicoId: servicoIds[k],
    profissionalId: typeof i.profissionalId === 'string' ? i.profissionalId.toLowerCase() : '',
    inicio: i.inicio,
  }));
  return {
    ok: true,
    itens,
    nome: cliente.nome,
    telefoneE164: cliente.telefoneE164,
    chave: bruta === null ? null : bruta.toLowerCase(),
    modo,
    malformados: {
      servicos: !servicoIds.every((s) => ehUuid(s)),
      profissionais: pedidos.flatMap((i, k) => (ehUuid(i.profissionalId) ? [] : [k])),
    },
  };
}
