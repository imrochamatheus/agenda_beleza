import { obterPrisma } from './db';
import type { Executor } from './transacao';

// Assinatura, transições e eventos de webhook de UM salão para o super admin (D-045, E8.3). Pré-contexto da
// plataforma, só leitura, sem trava. Nunca seleciona `provedor_assinatura_id` (só `vinculada`), `chave_dedupe`
// nem `recurso_id`. Índices existentes bastam (DBA §4): `webhook_evento (salao_id, recebido_em DESC)` e
// `assinatura_transicao (assinatura_id, ocorrida_em)`.

export const MAX_TRANSICOES = 50;
export const MAX_EVENTOS = 50;

export async function lerSalaoDaAssinatura(salaoId: string, db: Executor = obterPrisma()): Promise<{ id: string; nome: string; fuso: string } | null> {
  const [l] = await db.$queryRaw<{ id: string; nome: string; fuso: string }[]>`
    SELECT id::text AS id, nome, fuso FROM salao WHERE id = ${salaoId}::uuid`;
  return l ?? null;
}

export type LinhaDoResumo = {
  estado: string;
  vinculada: boolean;
  testeFimEm: Date | null;
  periodoPagoAte: Date | null;
  primeiraFalhaEm: Date | null;
  carenciaAte: Date | null;
  canceladaEm: Date | null;
  acessoAte: Date | null;
};

/** A vigente (`estado <> 'encerrada'`); sem vigente, a mais recente. Salão sem nenhuma → null. */
export async function lerResumo(salaoId: string, db: Executor = obterPrisma()): Promise<LinhaDoResumo | null> {
  const [l] = await db.$queryRaw<
    {
      estado: string;
      vinculada: boolean;
      teste_fim_em: Date | null;
      periodo_pago_ate: Date | null;
      primeira_falha_em: Date | null;
      carencia_ate: Date | null;
      cancelada_em: Date | null;
      acesso_ate: Date | null;
    }[]
  >`
    SELECT a.estado::text AS estado, (a.provedor_assinatura_id IS NOT NULL) AS vinculada, a.teste_fim_em,
           a.periodo_pago_ate, a.primeira_falha_em, a.carencia_ate, a.cancelada_em, a.acesso_ate
      FROM assinatura a
     WHERE a.salao_id = ${salaoId}::uuid
     ORDER BY (a.estado <> 'encerrada') DESC, a.criado_em DESC, a.id DESC
     LIMIT 1`;
  if (!l) return null;
  return {
    estado: l.estado,
    vinculada: l.vinculada,
    testeFimEm: l.teste_fim_em,
    periodoPagoAte: l.periodo_pago_ate,
    primeiraFalhaEm: l.primeira_falha_em,
    carenciaAte: l.carencia_ate,
    canceladaEm: l.cancelada_em,
    acessoAte: l.acesso_ate,
  };
}

export type LinhaDeTransicao = { id: string; de: string | null; para: string; causa: string; ocorridaEm: Date; origemEvento: boolean };

/** Transições de TODAS as assinaturas do salão, as mais recentes primeiro. */
export async function listarTransicoes(salaoId: string, db: Executor = obterPrisma()): Promise<LinhaDeTransicao[]> {
  const linhas = await db.$queryRaw<
    { id: string; de: string | null; para: string; causa: string; ocorrida_em: Date; origem_evento: boolean }[]
  >`
    SELECT t.id::text AS id, t.de::text AS de, t.para::text AS para, t.causa, t.ocorrida_em,
           (t.evento_id IS NOT NULL) AS origem_evento
      FROM assinatura_transicao t
      JOIN assinatura a ON a.id = t.assinatura_id
     WHERE a.salao_id = ${salaoId}::uuid
     ORDER BY t.ocorrida_em DESC, t.id DESC
     LIMIT ${MAX_TRANSICOES}::int`;
  return linhas.map((l) => ({ id: l.id, de: l.de, para: l.para, causa: l.causa, ocorridaEm: l.ocorrida_em, origemEvento: l.origem_evento }));
}

export type LinhaDeEvento = {
  id: string;
  tipo: string | null;
  resultado: string;
  origemValida: boolean;
  erro: string | null;
  recebidoEm: Date;
  processadoEm: Date | null;
  payload: unknown;
};

/** Eventos do salão (só os com `salao_id`), `MAX_EVENTOS + 1` para o serviço saber se há mais. */
export async function listarEventos(salaoId: string, db: Executor = obterPrisma()): Promise<LinhaDeEvento[]> {
  const linhas = await db.$queryRaw<
    {
      id: string;
      tipo: string | null;
      resultado: string;
      origem_valida: boolean;
      erro: string | null;
      recebido_em: Date;
      processado_em: Date | null;
      payload: unknown;
    }[]
  >`
    SELECT id::text AS id, tipo, resultado::text AS resultado, origem_valida, erro, recebido_em, processado_em, payload
      FROM webhook_evento
     WHERE salao_id = ${salaoId}::uuid
     ORDER BY recebido_em DESC, id DESC
     LIMIT ${MAX_EVENTOS + 1}::int`;
  return linhas.map((l) => ({
    id: l.id,
    tipo: l.tipo,
    resultado: l.resultado,
    origemValida: l.origem_valida,
    erro: l.erro,
    recebidoEm: l.recebido_em,
    processadoEm: l.processado_em,
    payload: l.payload,
  }));
}
