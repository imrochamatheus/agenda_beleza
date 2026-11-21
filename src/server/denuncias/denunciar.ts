import { hashIpDenuncia } from '@/server/protecao/chaves';
import { limitarPorIp } from '@/server/protecao/limite';
import { verificarHumano } from '@/server/protecao/turnstile';
import { inserirDenunciaPublica } from '@/server/repos/denuncia-publica';
import { ehUuid } from '@/server/repos/ids';
import { resolverSalaoPorSlug } from '@/server/repos/publico';
import { slugPlausivel } from '@/server/reserva-publica/passos';
import type { PublicoContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { TETO_PENDENTES } from './tipos';
import type { EntradaDenuncia, ResultadoDenuncia } from './tipos';
import { validarDenuncia } from './validacao';

// Denúncia pública de avaliação (D-035, RN-1 a RN-6). Sem next/*, sem 'use server'. Ordem:
// validar → limite por IP (escopo `denuncia`) → Turnstile → INSERT. Sucesso, duplicada, teto,
// avaliação inexistente, retirada, de outro salão ou id malformado respondem IGUAL (`recebida`, sem
// gravar): a resposta não revela se a avaliação existe. Nada é enfileirado nem notificado (CA-13).

export type DependenciasDenuncia = {
  limitarPorIp?: typeof limitarPorIp;
  verificarHumano?: typeof verificarHumano;
  hashIp?: (ip: string) => string;
};

/**
 * `ctx` nulo = salão inexistente: cumpre validação, limite e verificação humana (para não virar oráculo
 * de slugs) e responde `recebida` sem gravar.
 */
export async function denunciarAvaliacao(
  ctx: PublicoContext | null,
  e: EntradaDenuncia,
  agora: Date,
  deps: DependenciasDenuncia = {},
): Promise<ResultadoDenuncia> {
  const v = validarDenuncia(e);
  if (!v.ok) return { resultado: 'invalido', erros: v.erros };
  const lim = await (deps.limitarPorIp ?? limitarPorIp)(e.ip, 'denuncia', agora);
  if (!lim.permitido) return { resultado: 'limitado' };
  if (!(await (deps.verificarHumano ?? verificarHumano)(e.tokenHumano ?? null, e.ip))) {
    return { resultado: 'humano' };
  }
  if (ctx !== null && ehUuid(e.avaliacaoId)) {
    await inserirDenunciaPublica(ctx, {
      avaliacaoId: e.avaliacaoId,
      motivo: v.dados.motivo,
      texto: v.dados.texto,
      ipHash: (deps.hashIp ?? hashIpDenuncia)(e.ip),
      teto: TETO_PENDENTES,
    });
  }
  return { resultado: 'recebida' };
}

/** Entrada da página pública: resolve o slug (inclusive o antigo) e delega; slug desconhecido = `recebida`. */
export async function denunciarPorSlug(
  slug: string,
  e: EntradaDenuncia,
  agora: Date,
  deps: DependenciasDenuncia = {},
): Promise<ResultadoDenuncia> {
  let ctx: PublicoContext | null = null;
  if (slugPlausivel(slug)) {
    try {
      ctx = (await resolverSalaoPorSlug(slug)).contexto;
    } catch (erro) {
      if (!(erro instanceof NaoEncontrado)) throw erro;
    }
  }
  return denunciarAvaliacao(ctx, e, agora, deps);
}
