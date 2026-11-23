// Reserva feita pela página pública (D-026 §3; D-050 §3.10: N itens, cada um com profissional e horário).
// Sem next/*, sem 'use server'. Resolve o slug de novo, recusa antes de qualquer escrita se o salão não aceita
// reservas (CA-4) e chama `criarReserva` com `modo: 'normal'` fixo e o contexto de sistema `reserva_publica`.
// Todo resultado vira um desfecho pt-BR discriminado; nenhum é 500.
import { limitarPorIp, limitarPorNumero } from '@/server/protecao/limite';
import { criarAntesDaReserva } from '@/server/protecao/futuras';
import { MENSAGENS_PROTECAO } from '@/server/protecao/tipos';
import { verificarHumano } from '@/server/protecao/turnstile';
import { normalizarTelefoneBr } from '@/lib/telefone';
import { repos } from '@/server/repos';
import { ehUuid } from '@/server/repos/ids';
import { criarReserva } from '@/server/reservas/criar-reserva';
import type { DependenciasCriarReserva, ReservaCriada, ResultadoCriarReserva } from '@/server/reservas/tipos';
import { lerRotulosDaReserva, resolverSalaoPorSlug } from '@/server/repos/publico';
import { validarConsentimentoDaReserva } from '@/server/consentimento/validacao';
import { contextoDeSistema } from '@/server/tenant/context';
import type { PublicoContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { decidirAgendamento } from './estado';
import { chaveDeData, lerHorario, lerServicoIds, slugPlausivel } from './passos';
import { MENSAGENS_RESERVA_PUBLICA } from './tipos';
import type { EntradaReservaPublica, ResultadoReservaPublica, ResumoConfirmacao } from './tipos';
import { MENSAGENS_RESERVA } from '@/server/reservas/tipos';
import type { ItemPedido } from '@/server/reservas/tipos';
import { partesLocais } from '@/server/tempo/fuso';

function registrar(resultado: string, salaoId: string | null): void {
  // Só o resultado e o salão: nunca nome, telefone nem chave.
  console.info(JSON.stringify({ evento: 'reserva_publica.resultado', resultado, salaoId }));
}

async function montarResumo(ctx: PublicoContext, reserva: ReservaCriada): Promise<ResumoConfirmacao> {
  const itens = [...reserva.itens].sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || a.ordem - b.ordem);
  const rotulos = await lerRotulosDaReserva(
    ctx,
    itens.map((i) => i.servicoId),
    itens.map((i) => i.profissionalId),
  );
  return {
    fuso: rotulos.fuso,
    data: chaveDeData(partesLocais(itens[0].inicio, rotulos.fuso).data),
    itens: itens.map((i) => ({
      servicoNome: rotulos.servicos.get(i.servicoId) ?? 'Serviço',
      profissionalNome: rotulos.profissionais.get(i.profissionalId) ?? 'Profissional',
      inicioIso: i.inicio.toISOString(),
      fimIso: i.fim.toISOString(),
      precoCentavos: i.precoCentavos,
      duracaoMin: i.duracaoMin,
    })),
    totalCentavos: itens.filter((i) => i.status !== 'cancelado').reduce((t, i) => t + i.precoCentavos, 0),
  };
}

/**
 * Itens pedidos, validados na forma: `servicoIds` (1..10, sem repetição) e um item por serviço na MESMA
 * ordem, com início ISO canônico. O resto (UUID do profissional, data única, sobreposição, revalidação)
 * é de `criarReserva`.
 */
function lerItensPedidos(e: EntradaReservaPublica): { ok: true; itens: ItemPedido[] } | { ok: false; resultado: ResultadoReservaPublica } {
  const generico: ResultadoReservaPublica = { resultado: 'invalido', erros: { itens: MENSAGENS_RESERVA_PUBLICA.generico } };
  const s = lerServicoIds(e.servicoIds);
  if (s === null || !Array.isArray(e.itens) || e.itens.length !== s.length) return { ok: false, resultado: generico };
  const itens: ItemPedido[] = [];
  const porItem: Record<number, { inicio: string }> = {};
  for (const [k, x] of e.itens.entries()) {
    if (typeof x?.servicoId !== 'string' || x.servicoId.toLowerCase() !== s[k] || typeof x.profissionalId !== 'string') {
      return { ok: false, resultado: generico };
    }
    const inicio = lerHorario(x.inicio);
    if (inicio === null) porItem[k] = { inicio: MENSAGENS_RESERVA.inicio };
    else itens.push({ servicoId: s[k], profissionalId: x.profissionalId, inicio });
  }
  if (Object.keys(porItem).length > 0) {
    return { ok: false, resultado: { resultado: 'invalido', erros: { itens: MENSAGENS_RESERVA.inicio, porItem } } };
  }
  return { ok: true, itens };
}

/** Pontos de injeção da proteção (só testes); em produção valem os módulos reais. */
export type DependenciasProtecao = {
  limitarPorIp?: typeof limitarPorIp;
  limitarPorNumero?: typeof limitarPorNumero;
  verificarHumano?: typeof verificarHumano;
};

/**
 * Ordem (D-027 RN-7): slug/salão indisponível (antes de consumir cota) → IP → Turnstile → telefone →
 * número (só se a chave de requisição ainda não gravou reserva) → transação (limite de futuras em
 * `antesDaReserva`). Todo bloqueio acontece antes de qualquer escrita de cliente/reserva.
 */
export async function reservarPelaPagina(
  e: EntradaReservaPublica,
  agora: Date,
  deps: DependenciasCriarReserva = {},
  protecao: DependenciasProtecao = {},
): Promise<ResultadoReservaPublica> {
  const generico: ResultadoReservaPublica = { resultado: 'invalido', erros: { itens: MENSAGENS_RESERVA_PUBLICA.generico } };
  if (!slugPlausivel(e.slug)) return generico;
  let resolucao;
  try {
    resolucao = await resolverSalaoPorSlug(e.slug);
  } catch (erro) {
    if (erro instanceof NaoEncontrado) return generico;
    throw erro;
  }
  const ctx = resolucao.contexto;
  const salaoId = ctx.salaoId;

  if (resolucao.historico) {
    registrar('slug_mudou', salaoId);
    return { resultado: 'slug_mudou', slugAtual: resolucao.slugAtual };
  }

  const decisao = await decidirAgendamento(ctx, agora);
  if (!decisao.disponivel) {
    registrar('indisponivel', salaoId);
    return { resultado: 'indisponivel' };
  }

  const pedidos = lerItensPedidos(e);
  if (!pedidos.ok) return pedidos.resultado;

  const limitado: ResultadoReservaPublica = { resultado: 'limitado', mensagem: MENSAGENS_PROTECAO.limitado };
  const porIp = await (protecao.limitarPorIp ?? limitarPorIp)(e.ip, 'reserva', agora);
  if (!porIp.permitido) {
    registrar('limitado_ip', salaoId);
    return limitado;
  }
  if (!(await (protecao.verificarHumano ?? verificarHumano)(e.tokenHumano, e.ip))) {
    registrar('humano_recusado', salaoId);
    return { resultado: 'recusado', mensagem: MENSAGENS_PROTECAO.humano };
  }

  const chave = typeof e.chaveRequisicao === 'string' && ehUuid(e.chaveRequisicao) ? e.chaveRequisicao.toLowerCase() : null;
  const e164 = normalizarTelefoneBr(e.telefone);
  if (e164 !== null) {
    // A repetição da mesma requisição não consome cota do número (idempotência, D-027 §7).
    const ja = chave === null ? null : await repos().reservas.buscarPorChave(contextoDeSistema(salaoId, 'reserva_publica'), chave);
    if (ja === null) {
      const porNumero = await (protecao.limitarPorNumero ?? limitarPorNumero)(salaoId, e164, agora);
      if (!porNumero.permitido) {
        registrar('limitado_numero', salaoId);
        return limitado;
      }
    }
  }

  const r: ResultadoCriarReserva = await criarReserva(
    contextoDeSistema(salaoId, 'reserva_publica'),
    {
      itens: pedidos.itens,
      cliente: { nome: e.nome, telefone: e.telefone },
      aceites: e.aceites,
      chaveRequisicao: e.chaveRequisicao,
      modo: 'normal',
      agora,
    },
    {
      politica: () => decisao.disponivel ? { permitido: true } : { permitido: false, motivo: 'indisponivel' },
      antesDaReserva: criarAntesDaReserva({ chave, agora }),
      ...deps,
    },
  );
  registrar(r.resultado, salaoId);

  switch (r.resultado) {
    case 'criada':
    case 'repetida':
      return { resultado: 'confirmada', resumo: await montarResumo(ctx, r.reserva), repetida: r.resultado === 'repetida' };
    case 'horario_indisponivel':
      // CA-10: a casca monta a reescolha na resposta (sem redirecionar); o 23P01 não diz o item (itens: []).
      return { resultado: 'reescolher', itens: [...r.itens] };
    case 'servico_indisponivel':
      return { resultado: 'voltar', passo: 'servicos', aviso: 'servico_indisponivel' };
    case 'profissional_indisponivel':
      return { resultado: 'voltar', passo: 'servico', indice: r.itens.length > 0 ? Math.min(...r.itens) : 0, aviso: 'profissional_indisponivel' };
    case 'invalido': {
      // O criarReserva para no primeiro grupo de erros; a cliente vê nome, telefone e aceite juntos.
      const aceites = validarConsentimentoDaReserva(e.aceites);
      return { resultado: 'invalido', erros: { ...r.erros, ...(aceites.ok ? {} : aceites.erros) } };
    }
    case 'consentimento_ausente':
      return { resultado: 'invalido', erros: r.erros };
    case 'salao_indisponivel':
      return { resultado: 'indisponivel' };
    case 'chave_reutilizada':
    case 'encaixe_requer_confirmacao': // só da equipe (D-029); inalcançável no fluxo público
      return { resultado: 'recusado', mensagem: MENSAGENS_RESERVA_PUBLICA.recusada };
    case 'recusado':
      return { resultado: 'recusado', mensagem: r.motivo };
  }
}
