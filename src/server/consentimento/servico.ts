import { VERSAO_TERMOS, type Finalidade } from '@/config/termos';
import type { Repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import { exigirEscopo, type ContextoEscopado } from '@/server/tenant/context';

import type { ConsentimentoVisao, OrigemConsentimento, ResultadoConsentimentoDaReserva } from './tipos';
import {
  validarConsentimentoDaReserva,
  validarFinalidade,
  validarOrigemParaContexto,
  validarOrigemParaFinalidade,
} from './validacao';

// Serviço de consentimento (D-023 §3.4, §3.5). Sem next/*, sem 'use server'. Dentro da transação do
// chamador (parâmetro `r`) o consentimento some junto com a reserva desfeita (RN-9).

function registrarEvento(evento: string, dados: Record<string, string>): void {
  console.info(JSON.stringify({ evento, ...dados }));
}

function comRepos<T>(r: Repos | undefined, fn: (r: Repos) => Promise<T>): Promise<T> {
  return r ? fn(r) : emTransacao(fn);
}

/** Valida as regras de programação (RangeError) antes de tocar o banco. */
function validarEntrada(
  ctx: ContextoEscopado,
  finalidade: unknown,
  origem: OrigemConsentimento,
  agora: unknown,
): asserts finalidade is Finalidade {
  exigirEscopo(ctx);
  if (!validarFinalidade(finalidade)) {
    throw new RangeError('finalidade de consentimento inválida');
  }
  validarOrigemParaContexto(ctx, origem);
  validarOrigemParaFinalidade(origem, finalidade);
  if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) {
    throw new RangeError('agora deve ser uma Date válida');
  }
}

/**
 * Grava UMA linha de aceite (RN-4, RN-5). A versão é a vigente do config, nunca do chamador (A-7);
 * `deps.versaoVigente` existe só para os testes. Cliente inexistente, de outro salão, id inválido ou
 * anonimizada → NaoEncontrado. Erros de programação → RangeError.
 */
export async function registrarConsentimento(
  ctx: ContextoEscopado,
  e: { clienteId: string; finalidade: Finalidade; origem: OrigemConsentimento; agora: Date },
  r?: Repos,
  deps?: { versaoVigente?: () => string },
): Promise<ConsentimentoVisao> {
  validarEntrada(ctx, e.finalidade, e.origem, e.agora);
  const versao = deps?.versaoVigente ? deps.versaoVigente() : VERSAO_TERMOS;
  const linha = await comRepos(r, (t) =>
    t.consentimentos.registrar(ctx, {
      clienteId: e.clienteId,
      finalidade: e.finalidade,
      origem: e.origem,
      versaoTermos: versao,
      criadoEm: e.agora,
    }),
  );
  registrarEvento('consentimento.registrado', { consentimentoId: linha.id, finalidade: linha.finalidade, origem: linha.origem });
  return linha;
}

/**
 * Contrato da reserva (E3.2/E3.4/E4.2): valida `aceites` primeiro (inválido → { ok:false } sem tocar
 * o banco, sem lançar); `publico` grava mensagens_reserva e, se aceito, convite_avaliacao;
 * `equipe` lê só mensagensReserva e grava só mensagens_reserva (o convite é ignorado, A-3).
 * Sem `r`: todas as linhas ou nenhuma.
 */
export async function registrarConsentimentoDaReserva(
  ctx: ContextoEscopado,
  e: { clienteId: string; aceites: unknown; origem: OrigemConsentimento; agora: Date },
  r?: Repos,
): Promise<ResultadoConsentimentoDaReserva> {
  const lidos = validarConsentimentoDaReserva(e.aceites);
  if (!lidos.ok) return lidos;
  const finalidades: Finalidade[] = e.origem === 'equipe' ? ['mensagens_reserva'] : lidos.finalidades;
  // Falha de programação antes de qualquer escrita, mesmo com `aceites` válidos.
  validarEntrada(ctx, finalidades[0], e.origem, e.agora);
  const registrados = await comRepos(r, async (t) => {
    const saida: { id: string; finalidade: Finalidade }[] = [];
    for (const finalidade of finalidades) {
      const linha = await registrarConsentimento(ctx, { clienteId: e.clienteId, finalidade, origem: e.origem, agora: e.agora }, t);
      saida.push({ id: linha.id, finalidade: linha.finalidade });
    }
    return saida;
  });
  return { ok: true, registrados };
}
