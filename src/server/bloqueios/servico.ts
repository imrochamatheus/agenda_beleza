import { exigirPermissao, filtroDeProfissional } from '@/server/auth/permissoes';
import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import type { Repos } from '@/server/repos';
import type { BloqueioDTO } from '@/server/repos/tipos';
import type { TenantContext } from '@/server/tenant/context';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';

import * as apresentacao from './apresentacao';
import { ALVO_SALAO, LIMITES_BLOQUEIO, MENSAGENS_BLOQUEIO } from './tipos';
import type { BloqueioItem, OpcaoAlvo, ResultadoRemoverBloqueio, ResultadoSalvarBloqueio, ValoresBloqueio } from './tipos';
import { resolverPeriodo } from './validacao';

// Serviço de domínio dos bloqueios (D-016 §3.6; RN-1..RN-18). Sem next/*: as ações (bloqueios.acao.ts)
// e as páginas o chamam. Só usa o salão do contexto. Travas (repos/bloqueio.ts): criar só toma o FOR
// KEY SHARE implícito da FK no profissional; editar/remover travam a linha `FOR UPDATE OF b`. Nenhuma
// escrita em reserva, reserva_item ou mensagem e nenhum enfileiramento (RN-8).

/** Log estruturado de uma linha, só ids e contagens (o motivo NÃO vai para o log). */
function registrar(evento: string, dados: Record<string, unknown>): void {
  console.info(JSON.stringify({ evento, ...dados }));
}

/** RN-12: salão inteiro → bloqueio_salao.gerir; profissional → bloqueio_profissional.gerir no alvo. */
function exigirGestaoDoAlvo(ctx: TenantContext, profissionalId: string | null): void {
  if (profissionalId === null) {
    exigirPermissao(ctx, 'bloqueio_salao.gerir');
  } else {
    exigirPermissao(ctx, 'bloqueio_profissional.gerir', { profissionalId });
  }
}

const contexto = (ctx: TenantContext) => ({ papel: ctx.papel, profissionalId: ctx.profissionalId });

/** Lista vigente (RN-18): gestor vê todos; profissional, os dele (editáveis) + os do salão (somente leitura). */
export async function listar(ctx: TenantContext, agora: Date): Promise<{ itens: BloqueioItem[]; fuso: string }> {
  const filtro = filtroDeProfissional(ctx, 'bloqueio_profissional.gerir');
  const r = repos();
  const fuso = await r.bloqueios.fusoDoSalao(ctx);
  const linhas = await r.bloqueios.listarVigentes(ctx, agora, filtro);
  return { fuso, itens: linhas.map((l) => apresentacao.paraItem(l, fuso, contexto(ctx))) };
}

/** Opções de alvo do formulário: gestor → "Salão inteiro" + profissionais; profissional → null. */
export async function opcoesDeAlvo(ctx: TenantContext): Promise<OpcaoAlvo[] | null> {
  if (ctx.papel !== 'gestor') {
    exigirPermissao(ctx, 'bloqueio_profissional.gerir');
    return null;
  }
  return apresentacao.opcoesDeAlvo(await repos().bloqueios.listarProfissionais(ctx));
}

/** Página de edição: 404 (outro salão, inexistente, malformado) → 403 (não pode gerir o alvo). */
export async function obterParaEdicao(ctx: TenantContext, id: unknown): Promise<{ item: BloqueioItem; valores: ValoresBloqueio }> {
  if (typeof id !== 'string') {
    throw new NaoEncontrado();
  }
  const r = repos();
  const b = await r.bloqueios.buscar(ctx, id);
  exigirGestaoDoAlvo(ctx, b.profissionalId);
  const fuso = await r.bloqueios.fusoDoSalao(ctx);
  return { item: apresentacao.paraItem(b, fuso, contexto(ctx)), valores: apresentacao.valoresDeEdicao(b, fuso) };
}

/**
 * Alvo da criação (D-20): profissional → ausente/''/o próprio id = o próprio perfil; qualquer outro
 * valor (inclusive 'salao' e id de outro salão) → 403 SEM consultar. Gestor → ausente/'' → inválido;
 * 'salao' → null; outro texto → id (o salão é conferido depois, 404).
 */
function resolverAlvo(ctx: TenantContext, alvo: unknown): { ok: true; profissionalId: string | null } | { ok: false } {
  const valor = typeof alvo === 'string' ? alvo.trim() : alvo;
  if (ctx.papel === 'profissional') {
    if (ctx.profissionalId === null) throw new AcessoNegado('escopo próprio sem perfil de profissional');
    if (valor === undefined || valor === '' || valor === ctx.profissionalId) return { ok: true, profissionalId: ctx.profissionalId };
    throw new AcessoNegado('bloqueio de outro alvo');
  }
  if (valor === undefined || valor === '') return { ok: false };
  if (valor === ALVO_SALAO) return { ok: true, profissionalId: null };
  return { ok: true, profissionalId: String(valor) };
}

async function aviso(t: Repos, ctx: TenantContext, b: BloqueioDTO) {
  return t.reservas.listarConfirmadasQueCruzam(ctx, { de: b.inicio, ate: b.fim }, b.profissionalId, LIMITES_BLOQUEIO.avisoMax);
}

/** Cria (precedência D-20: validação → 403 do alvo → 404 do profissional). */
export async function criar(ctx: TenantContext, e: unknown, agora: Date): Promise<ResultadoSalvarBloqueio> {
  const fuso = await repos().bloqueios.fusoDoSalao(ctx);
  const v = resolverPeriodo(e, fuso, agora, { edicao: false });
  if (!v.ok) {
    return { resultado: 'invalido', erros: v.erros };
  }
  const alvo = resolverAlvo(ctx, v.alvo);
  if (!alvo.ok) {
    return { resultado: 'invalido', erros: { alvo: MENSAGENS_BLOQUEIO.alvo } };
  }
  exigirGestaoDoAlvo(ctx, alvo.profissionalId);
  const { b, r } = await emTransacao(async (t) => {
    if (alvo.profissionalId !== null) {
      await t.bloqueios.buscarProfissional(ctx, alvo.profissionalId);
    }
    const criado = await t.bloqueios.criar(ctx, { profissionalId: alvo.profissionalId, inicio: v.inicio, fim: v.fim, motivo: v.motivo });
    return { b: criado, r: await aviso(t, ctx, criado) };
  });
  registrar('bloqueio.criado', {
    salaoId: ctx.salaoId,
    bloqueioId: b.id,
    nivel: b.profissionalId === null ? 'salao' : 'profissional',
    reservasCobertas: r.total,
  });
  return { resultado: 'salvo', bloqueio: apresentacao.paraItem(b, fuso, contexto(ctx)), aviso: apresentacao.paraAviso(r, fuso) };
}

/** Edita início, fim e motivo (RN-11; precedência D-20: validação → 404 → 403). Dono e nível não mudam. */
export async function editar(ctx: TenantContext, e: unknown, agora: Date): Promise<ResultadoSalvarBloqueio> {
  const fuso = await repos().bloqueios.fusoDoSalao(ctx);
  const v = resolverPeriodo(e, fuso, agora, { edicao: true });
  if (!v.ok) {
    return { resultado: 'invalido', erros: v.erros };
  }
  const id = v.id;
  if (typeof id !== 'string') {
    throw new NaoEncontrado();
  }
  const { b, r } = await emTransacao(async (t) => {
    const atual = await t.bloqueios.travar(ctx, id);
    exigirGestaoDoAlvo(ctx, atual.profissionalId);
    const editado = await t.bloqueios.atualizarPeriodo(ctx, id, { inicio: v.inicio, fim: v.fim, motivo: v.motivo });
    return { b: editado, r: await aviso(t, ctx, editado) };
  });
  registrar('bloqueio.editado', {
    salaoId: ctx.salaoId,
    bloqueioId: b.id,
    nivel: b.profissionalId === null ? 'salao' : 'profissional',
    reservasCobertas: r.total,
  });
  return { resultado: 'salvo', bloqueio: apresentacao.paraItem(b, fuso, contexto(ctx)), aviso: apresentacao.paraAviso(r, fuso) };
}

/** Remove (RN-10; 404 → 403). Bloqueio já encerrado também é removível. */
export async function remover(ctx: TenantContext, e: unknown): Promise<ResultadoRemoverBloqueio> {
  const id = typeof e === 'object' && e !== null ? (e as { id?: unknown }).id : undefined;
  if (typeof id !== 'string') {
    throw new NaoEncontrado();
  }
  await emTransacao(async (t) => {
    const atual = await t.bloqueios.travar(ctx, id);
    exigirGestaoDoAlvo(ctx, atual.profissionalId);
    await t.bloqueios.remover(ctx, id);
  });
  registrar('bloqueio.removido', { salaoId: ctx.salaoId, bloqueioId: id });
  return { resultado: 'removido', id };
}
