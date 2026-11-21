import { exigirPermissao } from '@/server/auth/permissoes';
import type { PortaArmazenamento } from '@/server/integrations/armazenamento/port';
import { integracoes } from '@/server/integrations/registry';
import { repos } from '@/server/repos';
import { lerFotosPublicasDoSalao } from '@/server/repos/publico';
import type { PublicoContext, TenantContext } from '@/server/tenant/context';

import { ROTAS } from '@/config/navegacao';

import type { FotoDoPainel, FotoPublica } from './tipos';

// Leituras das fotos (D-021 §3.4; A-13). Única parte que conhece a porta e ROTAS: a E4.1 importa
// `lerFotosPublicas`, nunca o repositório nem monta URL à mão.

/** Fotos do salão por posição, para o painel (gestor). */
export async function listarFotosDoPainel(ctx: TenantContext): Promise<FotoDoPainel[]> {
  exigirPermissao(ctx, 'salao.configurar');
  return repos().fotos.listar(ctx);
}

/**
 * Fotos públicas do salão por posição: `{ id, url, alt, largura, altura }` e nada mais. Sem papel,
 * não filtra suspensão. `url` é a do bucket/CDN (S3_URL_PUBLICA) ou a rota da app.
 */
export async function lerFotosPublicas(
  ctx: PublicoContext,
  deps: { armazenamento?: PortaArmazenamento } = {},
): Promise<FotoPublica[]> {
  const linhas = await lerFotosPublicasDoSalao(ctx);
  if (linhas.length === 0) {
    return [];
  }
  const armazenamento = deps.armazenamento ?? integracoes().armazenamento;
  return linhas.map((l) => ({
    id: l.id,
    url: armazenamento.urlPublica(l.chave) ?? ROTAS.fotoPublica(l.id),
    alt: l.alt,
    largura: l.largura,
    altura: l.altura,
  }));
}
