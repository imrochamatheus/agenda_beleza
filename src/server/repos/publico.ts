import { criarPublicoContext, exigirPublico } from '@/server/tenant/context';
import type { PublicoContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { obterPrisma } from './db';

/**
 * Leituras da página pública (RN-3, CA-12). Só campos públicos, por `select` explícito: nunca e-mail,
 * usuario_id, dados de cliente ou de reserva. Só serviços e profissionais ATIVOS (RN-16).
 */
export type ResolucaoSlug = { contexto: PublicoContext; slugAtual: string; historico: boolean };
export type ServicoPublico = { id: string; nome: string; precoCentavos: number; duracaoMin: number };
export type ProfissionalPublico = { id: string; nome: string };

/**
 * Resolve o salão pelo slug (atual ou histórico), por comparação exata (a normalização é da
 * E1.1/E4.1). Inexistente → NaoEncontrado. `historico` indica slug antigo; o redirecionamento 301
 * para `slugAtual` é da E4.1.
 */
export async function resolverSalaoPorSlug(slug: string): Promise<ResolucaoSlug> {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new NaoEncontrado();
  }
  const prisma = obterPrisma();
  const registro = await prisma.salaoSlug.findUnique({
    where: { slug },
    select: { salaoId: true, atual: true },
  });
  if (!registro) {
    throw new NaoEncontrado();
  }
  const atual = registro.atual
    ? { slug }
    : await prisma.salaoSlug.findFirst({
        where: { salaoId: registro.salaoId, atual: true },
        select: { slug: true },
      });
  if (!atual) {
    throw new NaoEncontrado();
  }
  return {
    contexto: criarPublicoContext(registro.salaoId, atual.slug),
    slugAtual: atual.slug,
    historico: !registro.atual,
  };
}

export async function listarServicosPublicos(ctx: PublicoContext): Promise<ServicoPublico[]> {
  const salaoId = exigirPublico(ctx);
  return obterPrisma().servico.findMany({
    where: { salaoId, ativo: true },
    select: { id: true, nome: true, precoCentavos: true, duracaoMin: true },
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
  });
}

export async function listarProfissionaisPublicos(
  ctx: PublicoContext,
): Promise<ProfissionalPublico[]> {
  const salaoId = exigirPublico(ctx);
  return obterPrisma().profissional.findMany({
    where: { salaoId, ativo: true },
    select: { id: true, nome: true },
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
  });
}
