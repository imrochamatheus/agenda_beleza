import type { Papel, TenantContext } from '@/server/tenant/context';
import { AcessoNegado } from '@/server/tenant/erros';

// Matriz de permissões por papel (D-010 RN-3, RN-18; CA-11). É dado, não código espalhado: cada
// operação diz, por papel, se vale para todo o salão, só para o próprio profissional, para a
// plataforma (super admin, com TOTP na E1.5) ou se é negada. Falha fechada para o desconhecido.
// A política por estado do salão continua na capacidade de defineAcao (E6.4). Recurso de outro
// salão continua 404 (o repositório filtra antes, D-5).

export const OPERACOES = [
  'painel.acessar',
  'agenda.ver',
  'reserva.criar',
  'reserva.alterar',
  'bloqueio_profissional.gerir',
  'bloqueio_salao.gerir',
  'jornada.ver',
  'jornada.editar',
  'servico.gerir',
  'profissional.gerir',
  'cliente.gerir',
  'cliente.contato',
  'salao.configurar',
  'assinatura.gerir',
  'plataforma.administrar',
] as const;

export type Operacao = (typeof OPERACOES)[number];
export type Escopo = 'salao' | 'proprio' | 'plataforma' | 'negado';

type Linha = Readonly<Record<Papel, Escopo>>;

const linha = (gestor: Escopo, profissional: Escopo, super_admin: Escopo): Linha =>
  Object.freeze({ gestor, profissional, super_admin });

/** Tabela da RN-18 (spec §4). Congelada em profundidade. */
export const MATRIZ: Readonly<Record<Operacao, Linha>> = Object.freeze({
  'painel.acessar': linha('salao', 'proprio', 'negado'),
  'agenda.ver': linha('salao', 'proprio', 'negado'),
  'reserva.criar': linha('salao', 'proprio', 'negado'),
  'reserva.alterar': linha('salao', 'proprio', 'negado'),
  'bloqueio_profissional.gerir': linha('salao', 'proprio', 'negado'),
  'bloqueio_salao.gerir': linha('salao', 'negado', 'negado'),
  // D-015 D-8: o profissional só vê a própria jornada; editar é só do gestor (RN-1).
  'jornada.ver': linha('salao', 'proprio', 'negado'),
  'jornada.editar': linha('salao', 'negado', 'negado'),
  'servico.gerir': linha('salao', 'negado', 'negado'),
  'profissional.gerir': linha('salao', 'negado', 'negado'),
  'cliente.gerir': linha('salao', 'negado', 'negado'),
  // D-022 D-5: o profissional só lê o contato de quem tem reserva com ele (o serviço restringe).
  'cliente.contato': linha('salao', 'proprio', 'negado'),
  'salao.configurar': linha('salao', 'negado', 'negado'),
  'assinatura.gerir': linha('salao', 'negado', 'negado'),
  'plataforma.administrar': linha('negado', 'negado', 'plataforma'),
});

/**
 * Escopo do papel na operação. Papel ou operação fora dos conjuntos (inclusive 'toString',
 * '__proto__', undefined) → 'negado'.
 */
export function pode(papel: unknown, operacao: unknown): Escopo {
  if (typeof operacao !== 'string' || !Object.hasOwn(MATRIZ, operacao)) return 'negado';
  const l = MATRIZ[operacao as Operacao];
  if (typeof papel !== 'string' || !Object.hasOwn(l, papel)) return 'negado';
  return l[papel as Papel];
}

/**
 * Lança AcessoNegado se o escopo for 'negado' ou 'plataforma' (não se aplica a contexto de salão);
 * ou 'proprio' e o contexto não tem perfil de profissional; ou 'proprio', `alvo` informado e
 * `alvo.profissionalId` diferente do do contexto. 'proprio' sem `alvo` é checagem de operação: o
 * chamador restringe a consulta com `filtroDeProfissional` (DD-2).
 */
export function exigirPermissao(
  ctx: TenantContext,
  operacao: Operacao,
  alvo?: { profissionalId: string | null },
): void {
  const escopo = pode(ctx.papel, operacao);
  if (escopo === 'salao') return;
  if (escopo !== 'proprio') {
    throw new AcessoNegado(`operação ${operacao} negada ao papel`);
  }
  if (ctx.profissionalId === null) {
    throw new AcessoNegado('escopo próprio sem perfil de profissional');
  }
  if (alvo !== undefined && alvo.profissionalId !== ctx.profissionalId) {
    throw new AcessoNegado('recurso de outro profissional');
  }
}

/** Para listagens: 'salao' → todos; 'proprio' → só o perfil do contexto; demais → AcessoNegado. */
export function filtroDeProfissional(
  ctx: TenantContext,
  operacao: Operacao,
): { todos: true } | { profissionalId: string } {
  const escopo = pode(ctx.papel, operacao);
  if (escopo === 'salao') return { todos: true };
  if (escopo === 'proprio' && ctx.profissionalId !== null) {
    return { profissionalId: ctx.profissionalId };
  }
  throw new AcessoNegado(`operação ${operacao} sem escopo de listagem`);
}
