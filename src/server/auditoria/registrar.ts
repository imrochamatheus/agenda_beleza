import { inserirAuditoriaIndependente } from '@/server/repos/auditoria';
import { ehUuid } from '@/server/repos/ids';
import type { Repos } from '@/server/repos';
import { exigirAdmin } from '@/server/tenant/context';
import type { AdminContext } from '@/server/tenant/context';

import { rejeitarSegredos, validarJson } from './sanitizar';
import {
  ACOES_AUDITAVEIS,
  ACOES_COM_ANTES_DEPOIS,
  ENTIDADES_AUDITAVEIS,
  ErroAuditoriaEntrada,
  FORMATO_ACAO,
  MAX_ACAO,
  MAX_EMAIL,
  MAX_ENTIDADE_ID,
} from './tipos';
import type {
  AcaoAuditavel,
  EntidadeAuditavel,
  EntradaAuditoriaValidada,
  JsonObjeto,
} from './tipos';

// Serviço de auditoria (D-033). Somente escrita. Sem next/*, sem Prisma (o repositório é injetado).
// ATENÇÃO (R-2): `antes`/`depois` só carregam campos de negócio escolhidos pelo chamador, nunca
// linhas inteiras, nem PII/segredos em valores livres (só as CHAVES são varridas).

export type EntradaDeSucesso = {
  acao: AcaoAuditavel;
  entidade: EntidadeAuditavel;
  entidadeId: string;
  salaoId?: string | null;
  antes?: JsonObjeto | null;
  depois?: JsonObjeto | null;
};

export type EntradaDeFalha = {
  acao: AcaoAuditavel;
  entidade?: EntidadeAuditavel | null;
  entidadeId?: string | null;
  salaoId?: string | null;
  atorId?: string | null;
  atorEmailInformado?: string | null;
  antes?: JsonObjeto | null;
  depois?: JsonObjeto | null;
};

type Bruta = {
  atorId: string | null;
  atorEmailInformado?: string | null;
  acao: unknown;
  entidade?: unknown;
  entidadeId?: unknown;
  salaoId?: unknown;
  antes?: unknown;
  depois?: unknown;
  resultado: 'sucesso' | 'falha';
};

function uuidOpcional(v: unknown, campo: string): string | null {
  if (v === undefined || v === null) return null;
  if (!ehUuid(v)) throw new ErroAuditoriaEntrada(`${campo} deve ser um UUID`);
  return v;
}

function json(v: unknown, campo: string): JsonObjeto | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new ErroAuditoriaEntrada(`${campo} deve ser um objeto`);
  validarJson(v, campo);
  rejeitarSegredos(v, campo);
  return v as JsonObjeto;
}

/** Validação comum às duas vias. Lança ErroAuditoriaEntrada ou ErroAuditoriaSegredo; nunca grava. */
export function montarEntrada(b: Bruta): EntradaAuditoriaValidada {
  const { acao } = b;
  if (typeof acao !== 'string' || acao.length > MAX_ACAO || !FORMATO_ACAO.test(acao)) {
    throw new ErroAuditoriaEntrada('acao fora do formato entidade.verbo');
  }
  if (!(ACOES_AUDITAVEIS as readonly string[]).includes(acao)) {
    throw new ErroAuditoriaEntrada('acao fora do vocabulário');
  }
  const { entidade } = b;
  if (entidade !== undefined && entidade !== null) {
    if (typeof entidade !== 'string' || !(ENTIDADES_AUDITAVEIS as readonly string[]).includes(entidade)) {
      throw new ErroAuditoriaEntrada('entidade fora do vocabulário');
    }
  }
  const entidadeId = b.entidadeId ?? null;
  if (entidadeId !== null && (typeof entidadeId !== 'string' || entidadeId === '' || entidadeId.length > MAX_ENTIDADE_ID)) {
    throw new ErroAuditoriaEntrada('entidadeId inválido');
  }
  const email = b.atorEmailInformado ?? null;
  if (email !== null) {
    if (typeof email !== 'string' || email.length > MAX_EMAIL || /[\u0000-\u001f\u007f]/.test(email)) {
      throw new ErroAuditoriaEntrada('atorEmailInformado inválido');
    }
  }
  const antes = json(b.antes, 'antes');
  const depois = json(b.depois, 'depois');
  if (b.resultado === 'sucesso' && (ACOES_COM_ANTES_DEPOIS as readonly string[]).includes(acao) && (!antes || !depois)) {
    throw new ErroAuditoriaEntrada('antes e depois são obrigatórios para esta ação');
  }
  return {
    atorId: uuidOpcional(b.atorId, 'atorId'),
    atorEmailInformado: email === null ? null : (email as string).toLowerCase(),
    acao: acao as AcaoAuditavel,
    entidade: (entidade ?? null) as EntidadeAuditavel | null,
    entidadeId: entidadeId as string | null,
    salaoId: uuidOpcional(b.salaoId, 'salaoId'),
    antes,
    depois,
    resultado: b.resultado,
  } as EntradaAuditoriaValidada;
}

/**
 * Registra uma ação do super admin com sucesso, NA transação da mutação (`r` é obrigatório, RN-2):
 * qualquer erro (validação, segredo, FK) propaga e desfaz a transação do chamador. O ator é sempre
 * `ctx.usuarioId`; o resultado é sempre `sucesso`.
 */
export async function registrarAuditoria(
  ctx: AdminContext,
  e: EntradaDeSucesso,
  r: Repos,
): Promise<{ id: string }> {
  const atorId = exigirAdmin(ctx);
  return r.auditoria.inserir(
    montarEntrada({
      atorId,
      acao: e.acao,
      entidade: e.entidade,
      entidadeId: e.entidadeId,
      salaoId: e.salaoId,
      antes: e.antes,
      depois: e.depois,
      resultado: 'sucesso',
    }),
  );
}

/**
 * Registra uma falha (resultado `falha`) em conexão própria do pool, fora de qualquer transação do
 * chamador: persiste mesmo com rollback da principal. Chame no `catch`, DEPOIS do rollback: dentro da
 * transação, o INSERT (FOR KEY SHARE em usuario/salao) esperaria se ela ainda segurar FOR UPDATE nessas
 * linhas. Não exige contexto (login falho não tem ator). Erro de validação ou de banco propaga.
 */
export async function registrarFalhaAuditoria(e: EntradaDeFalha): Promise<void> {
  await inserirAuditoriaIndependente(montarEntrada({ ...e, atorId: e.atorId ?? null, resultado: 'falha' }));
}
