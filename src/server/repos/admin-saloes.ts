import { Prisma } from '@/generated/prisma/client';
import type { FiltroSuspensao, EstadoFiltro } from '@/server/admin/saloes-tipos';
import type { EstadoAssinatura } from '@/domain/assinatura';

import { obterPrisma } from './db';
import { criarRepos } from './index';
import type { Repos } from './index';
import { revogarSessoesDoUsuario } from './sessao';
import type { Executor } from './transacao';

// Salões vistos pelo super admin (D-044, E8.2). Repositório PRÉ-CONTEXTO da plataforma (como admin.ts):
// o admin não tem salão; cada operação usa só o `salaoId` informado, já validado como UUID pelo serviço,
// e o serviço decide a existência (404). NUNCA devolve hash de senha, TOTP, token nem
// `provedor_assinatura_id` fora de `lerParaExtensao`, que só o serviço de extensão consome.
//
// Ordem de travas (binding; cabeçalho de repos/servico.ts): salao (FOR NO KEY UPDATE, via RepoSalao.travar)
// → usuario (gestor, FOR UPDATE) → token/sessao → assinatura (FOR NO KEY UPDATE, via RepoAssinatura) →
// auditoria. Estender o teste NÃO trava `salao` (como webhook, retorno e job): só `assinatura`.
// Literais de estado na SQL (nunca parâmetro): `a.estado <> 'encerrada'` casa com o índice único parcial
// assinatura_vigente_por_salao_uniq (no máximo UMA vigente por salão), e `estado = 'em_teste'` no UPDATE.
// Todo UPDATE grava `atualizado_em` do relógio injetado.

/** Página da lista (= POR_PAGINA_SALOES). */
const POR_PAGINA = 20;

export type LinhaDaLista = {
  id: string;
  nome: string;
  slug: string;
  estado: EstadoAssinatura | null;
  suspenso: boolean;
  gestorEmail: string | null;
};

type LinhaBruta = {
  total: number;
  id: string;
  nome: string;
  slug: string;
  estado: EstadoAssinatura | null;
  suspenso: boolean;
  gestor_email: string | null;
};

/**
 * Lista + total em UM comando (`count(*) OVER ()`). Busca por `position(chave IN …)` (literal: `%`, `_` e
 * `\` não precisam de escape) em nome normalizado (NFD, sem U+0300..U+036F, minúsculas, a MESMA regra de
 * `chaveDeBusca`), slug ATUAL e e-mail do gestor. Página além do fim → 0 linhas (total 0).
 */
export async function listarSaloes(
  f: {
    chave: string;
    estado: EstadoFiltro | null;
    suspenso: FiltroSuspensao;
    pagina: number;
  },
  db: Executor = obterPrisma(),
): Promise<{ itens: LinhaDaLista[]; total: number }> {
  const deslocamento = (Math.max(1, Math.trunc(f.pagina)) - 1) * POR_PAGINA;
  const linhas = await db.$queryRaw<LinhaBruta[]>`
    SELECT count(*) OVER ()::int AS total, s.id::text AS id, s.nome, sl.slug, a.estado::text AS estado,
           (s.suspenso_manual_em IS NOT NULL) AS suspenso, g.email AS gestor_email
      FROM salao s
      JOIN salao_slug sl ON sl.salao_id = s.id AND sl.atual
      LEFT JOIN assinatura a ON a.salao_id = s.id AND a.estado <> 'encerrada'
      LEFT JOIN usuario g ON g.salao_id = s.id AND g.papel = 'gestor'
     WHERE (${f.chave}::text = ''
            OR position(${f.chave}::text IN lower(regexp_replace(normalize(s.nome, NFD), '[\\u0300-\\u036f]', '', 'g'))) > 0
            OR position(${f.chave}::text IN sl.slug) > 0
            OR position(${f.chave}::text IN g.email) > 0)
       AND (${f.estado}::text IS NULL
            OR (${f.estado}::text = 'sem_assinatura' AND a.id IS NULL)
            OR a.estado::text = ${f.estado}::text)
       AND (${f.suspenso}::text = 'todas'
            OR (${f.suspenso}::text = 'sim' AND s.suspenso_manual_em IS NOT NULL)
            OR (${f.suspenso}::text = 'nao' AND s.suspenso_manual_em IS NULL))
     ORDER BY s.nome COLLATE "C", s.id
     LIMIT ${POR_PAGINA}::int OFFSET ${deslocamento}::bigint`;
  return {
    total: linhas[0]?.total ?? 0,
    itens: linhas.map((l) => ({
      id: l.id,
      nome: l.nome,
      slug: l.slug,
      estado: l.estado,
      suspenso: l.suspenso,
      gestorEmail: l.gestor_email,
    })),
  };
}

export type LinhaDoDetalhe = {
  id: string;
  nome: string;
  slug: string;
  fuso: string;
  gradeMin: number;
  antecedenciaMin: number;
  janelaDias: number;
  intervaloMin: number;
  suspensoManualEm: Date | null;
  gestor: { nome: string; email: string; confirmado: boolean } | null;
  assinatura: { estado: EstadoAssinatura; testeFimEm: Date | null; vinculada: boolean } | null;
};

type DetalheBruto = {
  id: string;
  nome: string;
  slug: string;
  fuso: string;
  grade_min: number;
  antecedencia_min: number;
  janela_dias: number;
  intervalo_min: number;
  suspenso_manual_em: Date | null;
  gestor_nome: string | null;
  gestor_email: string | null;
  gestor_confirmado: boolean | null;
  estado: EstadoAssinatura | null;
  teste_fim_em: Date | null;
  vinculada: boolean | null;
};

/** Salão + regras + slug atual + gestor + assinatura vigente, em um comando e sem trava. Sem linha → null. */
export async function lerDetalhe(salaoId: string): Promise<LinhaDoDetalhe | null> {
  const [l] = await obterPrisma().$queryRaw<DetalheBruto[]>`
    SELECT s.id::text AS id, s.nome, sl.slug, s.fuso, s.grade_min, s.antecedencia_min, s.janela_dias,
           s.intervalo_min, s.suspenso_manual_em,
           g.nome AS gestor_nome, g.email AS gestor_email, (g.email_confirmado_em IS NOT NULL) AS gestor_confirmado,
           a.estado::text AS estado, a.teste_fim_em, (a.provedor_assinatura_id IS NOT NULL) AS vinculada
      FROM salao s
      JOIN salao_slug sl ON sl.salao_id = s.id AND sl.atual
      LEFT JOIN assinatura a ON a.salao_id = s.id AND a.estado <> 'encerrada'
      LEFT JOIN usuario g ON g.salao_id = s.id AND g.papel = 'gestor'
     WHERE s.id = ${salaoId}::uuid`;
  if (!l) return null;
  return {
    id: l.id,
    nome: l.nome,
    slug: l.slug,
    fuso: l.fuso,
    gradeMin: l.grade_min,
    antecedenciaMin: l.antecedencia_min,
    janelaDias: l.janela_dias,
    intervaloMin: l.intervalo_min,
    suspensoManualEm: l.suspenso_manual_em,
    gestor: l.gestor_email === null ? null : { nome: l.gestor_nome as string, email: l.gestor_email, confirmado: l.gestor_confirmado === true },
    assinatura: l.estado === null ? null : { estado: l.estado, testeFimEm: l.teste_fim_em, vinculada: l.vinculada === true },
  };
}

export type AssinaturaParaExtensao = {
  id: string;
  estado: string;
  testeFimEm: Date | null;
  /** Só aqui: o identificador no provedor nunca sai desta camada para a tela. */
  provedorAssinaturaId: string | null;
};

/**
 * Assinatura vigente do salão para a extensão do teste (sem trava). `existe: false` = salão inexistente;
 * `assinatura: null` = salão sem assinatura vigente.
 */
export async function lerParaExtensao(
  salaoId: string,
): Promise<{ existe: false } | { existe: true; assinatura: AssinaturaParaExtensao | null }> {
  const linhas = await obterPrisma().$queryRaw<
    { assinatura_id: string | null; estado: string | null; teste_fim_em: Date | null; provedor: string | null }[]
  >`
    SELECT a.id::text AS assinatura_id, a.estado::text AS estado, a.teste_fim_em, a.provedor_assinatura_id AS provedor
      FROM salao s
      LEFT JOIN assinatura a ON a.salao_id = s.id AND a.estado <> 'encerrada'
     WHERE s.id = ${salaoId}::uuid`;
  const l = linhas[0];
  if (!l) return { existe: false };
  if (l.assinatura_id === null) return { existe: true, assinatura: null };
  return {
    existe: true,
    assinatura: { id: l.assinatura_id, estado: l.estado as string, testeFimEm: l.teste_fim_em, provedorAssinaturaId: l.provedor },
  };
}

export type GestorTravado = { id: string; nome: string; email: string; confirmado: boolean };

/** Operações ligadas a UMA transação (ordem de travas no cabeçalho). */
export interface OperacoesSaloes {
  /** Gestor do salão `FOR UPDATE` (depois da trava do salão). Sem gestor → null. */
  travarGestor(salaoId: string): Promise<GestorTravado | null>;
  /** Outro usuário já usa o e-mail (já em minúsculas)? Só confirmados no momento; a corrida cai no 23505. */
  emailEmUso(email: string, exceto: string): Promise<boolean>;
  /** Nome e/ou e-mail do gestor; e-mail novo zera `email_confirmado_em`. */
  atualizarGestor(d: { id: string; nome: string | null; email: string | null; agora: Date }): Promise<void>;
  /** Invalida os tokens pendentes (confirmação e recuperação) do usuário. */
  invalidarTokensPendentes(usuarioId: string, agora: Date): Promise<void>;
  inserirTokenConfirmacao(d: { usuarioId: string; tokenHash: string; expiraEm: Date; agora: Date }): Promise<void>;
  /** Revoga as sessões do usuário na transação corrente. */
  revogarSessoes(usuarioId: string, agora: Date): Promise<number>;
  /** `suspenso_manual_em` do salão (lido sob a trava do salão). */
  suspensaoDoSalao(salaoId: string): Promise<Date | null>;
  /** UPDATE condicional `WHERE suspenso_manual_em IS NULL`; false = já estava suspenso. */
  suspender(salaoId: string, agora: Date): Promise<boolean>;
  /** UPDATE condicional `WHERE suspenso_manual_em IS NOT NULL`; false = não estava suspenso. */
  reativar(salaoId: string, agora: Date): Promise<boolean>;
  /** `UPDATE … WHERE id AND estado = 'em_teste' AND teste_fim_em = de`; false = 0 linhas. */
  estenderTesteSeIgual(d: { assinaturaId: string; de: Date; para: Date; agora: Date }): Promise<boolean>;
  /** Estado atual da assinatura (depois de um UPDATE com 0 linhas, para escolher mudou × divergência). */
  lerAssinatura(assinaturaId: string): Promise<{ estado: string; testeFimEm: Date | null } | null>;
}

function operacoes(tx: Prisma.TransactionClient): OperacoesSaloes {
  return {
    async travarGestor(salaoId) {
      const [g] = await tx.$queryRaw<{ id: string; nome: string; email: string; confirmado: boolean }[]>`
        SELECT id::text AS id, nome, email, (email_confirmado_em IS NOT NULL) AS confirmado
          FROM usuario WHERE salao_id = ${salaoId}::uuid AND papel = 'gestor' FOR UPDATE`;
      return g ?? null;
    },
    async emailEmUso(email, exceto) {
      const linhas = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM usuario WHERE email = ${email}::text AND id <> ${exceto}::uuid`;
      return linhas.length > 0;
    },
    async atualizarGestor(d) {
      await tx.$executeRaw`
        UPDATE usuario
           SET nome = COALESCE(${d.nome}::text, nome),
               email = COALESCE(${d.email}::text, email),
               email_confirmado_em = CASE WHEN ${d.email}::text IS NOT NULL THEN NULL ELSE email_confirmado_em END,
               atualizado_em = ${d.agora}::timestamptz
         WHERE id = ${d.id}::uuid AND papel = 'gestor'`;
    },
    async invalidarTokensPendentes(usuarioId, agora) {
      await tx.$executeRaw`
        UPDATE token SET invalidado_em = ${agora}::timestamptz
         WHERE usuario_id = ${usuarioId}::uuid AND usado_em IS NULL AND invalidado_em IS NULL`;
    },
    async inserirTokenConfirmacao(d) {
      await tx.$executeRaw`
        INSERT INTO token (usuario_id, tipo, token_hash, expira_em, criado_em)
        VALUES (${d.usuarioId}::uuid, 'confirmacao_email'::tipo_token, ${d.tokenHash}::text,
                ${d.expiraEm}::timestamptz, ${d.agora}::timestamptz)`;
    },
    revogarSessoes: (usuarioId, agora) => revogarSessoesDoUsuario(usuarioId, agora, tx),
    async suspensaoDoSalao(salaoId) {
      const [l] = await tx.$queryRaw<{ em: Date | null }[]>`
        SELECT suspenso_manual_em AS em FROM salao WHERE id = ${salaoId}::uuid`;
      return l?.em ?? null;
    },
    async suspender(salaoId, agora) {
      const n = await tx.$executeRaw`
        UPDATE salao SET suspenso_manual_em = ${agora}::timestamptz, atualizado_em = ${agora}::timestamptz
         WHERE id = ${salaoId}::uuid AND suspenso_manual_em IS NULL`;
      return n === 1;
    },
    async reativar(salaoId, agora) {
      const n = await tx.$executeRaw`
        UPDATE salao SET suspenso_manual_em = NULL, atualizado_em = ${agora}::timestamptz
         WHERE id = ${salaoId}::uuid AND suspenso_manual_em IS NOT NULL`;
      return n === 1;
    },
    async estenderTesteSeIgual(d) {
      const n = await tx.$executeRaw`
        UPDATE assinatura SET teste_fim_em = ${d.para}::timestamptz, atualizado_em = ${d.agora}::timestamptz
         WHERE id = ${d.assinaturaId}::uuid AND estado = 'em_teste' AND teste_fim_em = ${d.de}::timestamptz`;
      return n === 1;
    },
    async lerAssinatura(assinaturaId) {
      const [l] = await tx.$queryRaw<{ estado: string; teste_fim_em: Date | null }[]>`
        SELECT estado::text AS estado, teste_fim_em FROM assinatura WHERE id = ${assinaturaId}::uuid`;
      return l ? { estado: l.estado, testeFimEm: l.teste_fim_em } : null;
    },
  };
}

/** Uma transação READ COMMITTED com as operações dos salões e os repositórios (salão, assinatura, auditoria). */
export function emTransacaoSaloes<T>(fn: (op: OperacoesSaloes, r: Repos) => Promise<T>): Promise<T> {
  return obterPrisma().$transaction((tx) => fn(operacoes(tx), criarRepos(tx)), {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}
