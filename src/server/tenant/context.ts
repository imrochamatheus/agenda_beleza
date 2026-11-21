import { ehUuid } from '@/server/repos/ids';

/**
 * Contextos de execução (D-005 §3.1). Cada tipo tem um discriminante `tipo` e uma marca nominal
 * (símbolo só de tipo, não exportado): um literal `{ tipo: 'tenant', ... }` não compila como
 * contexto. Os contextos só nascem pelas fábricas abaixo, chamadas apenas em:
 * - tenant/sessao.ts (tenant, admin);
 * - repos/publico.ts (publico);
 * - worker (sistema, E7.x).
 */
// União literal (S-6a); a equivalência com o enum do Prisma é conferida em repos/tipos.ts.
export type Papel = 'gestor' | 'profissional' | 'super_admin';
export type PapelDeSalao = Exclude<Papel, 'super_admin'>;

export const PAPEIS_DE_SALAO = ['gestor', 'profissional'] as const satisfies readonly PapelDeSalao[];

export const CAPACIDADES = [
  'leitura',
  'configurar',
  'agendar',
  'cancelar',
  'assinatura',
  'lgpd',
] as const;
export type Capacidade = (typeof CAPACIDADES)[number];

declare const marca: unique symbol;
type Marcado<T> = T & { readonly [marca]: true };

export type TenantContext = Marcado<{
  readonly tipo: 'tenant';
  readonly usuarioId: string;
  readonly papel: PapelDeSalao;
  readonly salaoId: string;
  /** Perfil de profissional vinculado ao usuário (gestor que atende ou profissional); senão null. */
  readonly profissionalId: string | null;
}>;
/** Processos sem usuário (worker, E7.x), com salão explícito. */
export type SistemaContext = Marcado<{
  readonly tipo: 'sistema';
  readonly salaoId: string;
  readonly origem: string;
}>;
/** Página pública: salão resolvido pelo slug. Só aceito pelas leituras públicas. */
export type PublicoContext = Marcado<{
  readonly tipo: 'publico';
  readonly salaoId: string;
  readonly slugAtual: string;
}>;
/** Super admin com TOTP verificado (E8.1). Nunca aceito pelos repositórios de tenant. */
export type AdminContext = Marcado<{ readonly tipo: 'admin'; readonly usuarioId: string }>;

/** Únicos contextos aceitos pelos repositórios de tenant. */
export type ContextoEscopado = TenantContext | SistemaContext;

/** Leituras de agenda (disponibilidade): página pública, equipe e sistema. Nunca admin (D-018 A-2). */
export type ContextoDeLeituraDeAgenda = PublicoContext | ContextoEscopado;

export function ehPapelDeSalao(v: unknown): v is PapelDeSalao {
  return (PAPEIS_DE_SALAO as readonly unknown[]).includes(v);
}

export function ehCapacidade(v: unknown): v is Capacidade {
  return (CAPACIDADES as readonly unknown[]).includes(v);
}

function exigirUuid(valor: unknown, campo: string): string {
  if (!ehUuid(valor)) {
    throw new Error(`${campo} do contexto deve ser um UUID`);
  }
  return valor;
}

export function criarTenantContext(d: {
  usuarioId: string;
  papel: PapelDeSalao;
  salaoId: string;
  profissionalId: string | null;
}): TenantContext {
  if (!ehPapelDeSalao(d.papel)) {
    throw new Error('papel do contexto de salão inválido');
  }
  return Object.freeze({
    tipo: 'tenant',
    usuarioId: exigirUuid(d.usuarioId, 'usuarioId'),
    papel: d.papel,
    salaoId: exigirUuid(d.salaoId, 'salaoId'),
    profissionalId: d.profissionalId === null ? null : exigirUuid(d.profissionalId, 'profissionalId'),
  }) as TenantContext;
}

export function criarAdminContext(usuarioId: string): AdminContext {
  return Object.freeze({
    tipo: 'admin',
    usuarioId: exigirUuid(usuarioId, 'usuarioId'),
  }) as AdminContext;
}

export function criarPublicoContext(salaoId: string, slugAtual: string): PublicoContext {
  return Object.freeze({
    tipo: 'publico',
    salaoId: exigirUuid(salaoId, 'salaoId'),
    slugAtual,
  }) as PublicoContext;
}

/** Contexto do worker e de outros processos sem usuário. Lança Error se o salaoId não for UUID. */
export function contextoDeSistema(salaoId: string, origem: string): SistemaContext {
  return Object.freeze({
    tipo: 'sistema',
    salaoId: exigirUuid(salaoId, 'salaoId'),
    origem,
  }) as SistemaContext;
}

/**
 * Guarda em tempo de execução, além do tipo: só `tenant` e `sistema` com salaoId UUID passam.
 * Qualquer outra coisa (admin, publico, objeto forjado com `as`) é erro de programação: lança Error
 * (500), nunca um erro de domínio. Devolve o salaoId a usar no predicado.
 */
export function exigirEscopo(ctx: ContextoEscopado): string {
  const c = ctx as unknown as { tipo?: unknown; salaoId?: unknown } | null | undefined;
  if (
    typeof c !== 'object' ||
    c === null ||
    (c.tipo !== 'tenant' && c.tipo !== 'sistema') ||
    !ehUuid(c.salaoId)
  ) {
    throw new Error('operação de tenant exige TenantContext ou SistemaContext');
  }
  return c.salaoId;
}

/** Guarda das leituras públicas: só `PublicoContext`. Devolve o salaoId. */
export function exigirPublico(ctx: PublicoContext): string {
  const c = ctx as unknown as { tipo?: unknown; salaoId?: unknown } | null | undefined;
  if (typeof c !== 'object' || c === null || c.tipo !== 'publico' || !ehUuid(c.salaoId)) {
    throw new Error('leitura pública exige PublicoContext');
  }
  return c.salaoId;
}

/**
 * Guarda das leituras de agenda (D-018 A-2): só `publico`, `tenant` e `sistema` com salaoId UUID.
 * Admin, objeto forjado ou salaoId inválido é erro de programação (Error, 500). Devolve o salaoId.
 */
export function exigirLeituraDeAgenda(ctx: ContextoDeLeituraDeAgenda): string {
  const c = ctx as unknown as { tipo?: unknown; salaoId?: unknown } | null | undefined;
  if (
    typeof c !== 'object' ||
    c === null ||
    (c.tipo !== 'publico' && c.tipo !== 'tenant' && c.tipo !== 'sistema') ||
    !ehUuid(c.salaoId)
  ) {
    throw new Error('leitura de agenda exige PublicoContext, TenantContext ou SistemaContext');
  }
  return c.salaoId;
}
