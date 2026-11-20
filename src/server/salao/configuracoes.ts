import { exigirPermissao } from '@/server/auth/permissoes';
import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import type { TenantContext } from '@/server/tenant/context';

import { opcoesDeFuso } from './fusos';
import { MENSAGENS_CONFIGURACOES } from './tipos';
import type { ConfiguracoesSalao, EntradaRegras, ResultadoSalvarRegras, ResultadoTrocarSlug } from './tipos';
import { normalizarSlug, validarNovoSlug, validarRegras, valoresDoSalao } from './validacao';

// Serviço das configurações do salão (D-017 §3.5; RN-7..RN-18). Sem next/*: as ações
// (configuracoes.acao.ts) e a página o chamam. Só o salão do contexto. Cada função começa por
// exigirPermissao (segunda barreira, depois de defineAcao). A gravação das regras e a troca de slug
// travam a linha de `salao` (FOR NO KEY UPDATE, D-18) e se serializam entre si; nada aqui toca
// reservas, jornadas nem bloqueios (RN-5, RN-16, RN-17).

/** Log estruturado de uma linha, só ids e resultados (nenhum valor de campo). */
function registrar(evento: string, dados: Record<string, unknown>): void {
  console.info(JSON.stringify({ evento, ...dados }));
}

/** Valores, opções de fuso e slugs do salão do contexto (página). */
export async function obter(ctx: TenantContext): Promise<ConfiguracoesSalao> {
  exigirPermissao(ctx, 'salao.configurar');
  const r = repos();
  const [c, slugs] = await Promise.all([r.saloes.obterConfiguracoes(ctx), r.saloes.listarSlugs(ctx)]);
  return {
    valores: valoresDoSalao(c),
    fusos: opcoesDeFuso(c.fuso),
    slug: { atual: slugs.atual, anteriores: slugs.anteriores.map((s) => s.slug) },
  };
}

/** Grava os seis campos de uma vez ou nenhum (RN-15). Prevalece a última gravação (D-11). */
export async function salvarRegras(ctx: TenantContext, e: unknown): Promise<ResultadoSalvarRegras> {
  exigirPermissao(ctx, 'salao.configurar');
  const entrada: EntradaRegras = typeof e === 'object' && e !== null && !Array.isArray(e) ? (e as EntradaRegras) : {};
  const r = await emTransacao(async (t): Promise<ResultadoSalvarRegras> => {
    const { fuso } = await t.saloes.travar(ctx);
    const v = validarRegras(entrada, { fusoAtual: fuso });
    if (!v.ok) {
      return { resultado: 'invalido', erros: v.erros };
    }
    await t.saloes.atualizarConfiguracoes(ctx, v.regras);
    return { resultado: 'salvo', valores: valoresDoSalao(v.regras) };
  });
  if (r.resultado === 'salvo') {
    registrar('salao.configuracoes_salvas', { salaoId: ctx.salaoId });
  }
  return r;
}

/**
 * Troca o slug (RN-12..RN-15). Igual ao atual → sem_efeito ANTES de validar o formato (D-9, D-21);
 * reservado/formato → invalido; de outro salão → invalido (em uso), sem gravar nada.
 */
export async function trocarSlug(ctx: TenantContext, e: unknown): Promise<ResultadoTrocarSlug> {
  exigirPermissao(ctx, 'salao.configurar');
  const bruto = typeof e === 'object' && e !== null ? (e as { slug?: unknown }).slug : undefined;
  const n = normalizarSlug(bruto);
  if (n === null) {
    return { resultado: 'invalido', erros: { slug: MENSAGENS_CONFIGURACOES.slugFormato } };
  }
  const r = await emTransacao(async (t): Promise<ResultadoTrocarSlug | { resultado: 'em_uso' }> => {
    await t.saloes.travar(ctx);
    const atual = await t.saloes.slugAtual(ctx);
    if (n === atual) {
      return { resultado: 'sem_efeito', slug: atual };
    }
    const erro = validarNovoSlug(n);
    if (erro !== null) {
      return { resultado: 'invalido', erros: { slug: erro } };
    }
    return (await t.saloes.trocarSlug(ctx, n)) === 'em_uso' ? { resultado: 'em_uso' } : { resultado: 'trocado', slug: n };
  });
  if (r.resultado !== 'invalido') {
    registrar('salao.slug_trocado', { salaoId: ctx.salaoId, resultado: r.resultado });
  }
  if (r.resultado === 'em_uso') {
    return { resultado: 'invalido', erros: { slug: MENSAGENS_CONFIGURACOES.slugEmUso } };
  }
  return r;
}
