import { ehCapacidade, ehPapelDeSalao } from './context';
import type { Capacidade, PapelDeSalao, TenantContext } from './context';
import { AcessoNegado, ehErroDeDominio } from './erros';
import type { CodigoErro, StatusErro } from './erros';
import { lerCredencialDoCookie } from './next';
import { politicaDeOperacao } from './politica';
import type { PoliticaOperacao } from './politica';
import { resolverTenant } from './sessao';
import type { Credencial } from './sessao';

/** Chave dos metadados de registro (papeis e capacidade), lida pelo teste de registro (CA-4). */
export const METADADOS_ACAO: unique symbol = Symbol.for('agenda-beleza.metadados-acao');

/** `papeis` (ao menos um) e `capacidade` são obrigatórios no tipo (RN-6). */
export type ConfigAcao = {
  papeis: readonly [PapelDeSalao, ...PapelDeSalao[]];
  capacidade: Capacidade;
};

export type ResultadoAcao<O> =
  | { ok: true; dados: O }
  | { ok: false; erro: CodigoErro; status: StatusErro };

/** Injeções do núcleo (testes): política de operação e relógio. */
export type DepsAcao = { politica?: PoliticaOperacao; agora?: Date };

/**
 * Dados da execução entregues ao handler (D-013 D-15): `agora` é o MESMO instante usado para
 * resolver a sessão (relógio único por execução; `deps.agora` nos testes, senão o relógio real).
 */
export type ExecucaoAcao = { readonly agora: Date };

export interface Acao<I, O> {
  /** Forma chamável usada pelo Next: lê o cookie de sessão (next/headers) e chama `executar`. */
  (input: I): Promise<ResultadoAcao<O>>;
  /** Núcleo, sem next/headers: recebe a credencial já lida. */
  executar(c: Credencial, input: I, deps?: DepsAcao): Promise<ResultadoAcao<O>>;
  readonly [METADADOS_ACAO]: Readonly<ConfigAcao>;
}

/**
 * Configuração válida em tempo de execução. O tipo já exige ambos os campos, mas um `.acao.ts`
 * com `@ts-expect-error` ou JS chega aqui sem eles: a ação fica registrada (para o teste de
 * registro acusá-la pelo nome) e recusa executar (fail closed).
 */
function configValida(config: ConfigAcao): boolean {
  return (
    ehCapacidade(config?.capacidade) &&
    Array.isArray(config?.papeis) &&
    config.papeis.length > 0 &&
    config.papeis.every(ehPapelDeSalao)
  );
}

function congelarConfig(config: ConfigAcao): Readonly<ConfigAcao> {
  const papeis = Array.isArray(config?.papeis) ? Object.freeze([...config.papeis]) : config?.papeis;
  return Object.freeze({ ...config, papeis }) as Readonly<ConfigAcao>;
}

/**
 * Define uma ação autenticada de equipe. Ordem do núcleo (RN-7):
 * resolver sessão → conferir papel → consultar a política com a capacidade → handler.
 * Qualquer recusa interrompe antes do handler. Um ErroDeDominio lançado em qualquer etapa (inclusive
 * pelo handler, p.ex. NaoEncontrado do repositório) vira `{ ok: false }`; outros erros são relançados.
 * O handler recebe o input sem transformação; o salaoId vem só do contexto (RN-1, CA-7). O terceiro
 * argumento do handler (opcional) traz o relógio da execução (D-013 D-15).
 */
export function defineAcao<I, O>(
  config: ConfigAcao,
  handler: (ctx: TenantContext, input: I, exec: ExecucaoAcao) => Promise<O>,
): Acao<I, O> {
  const metadados = congelarConfig(config);

  async function executar(c: Credencial, input: I, deps: DepsAcao = {}): Promise<ResultadoAcao<O>> {
    if (!configValida(metadados)) {
      throw new Error('ação sem papeis ou capacidade válidos');
    }
    const politica = deps.politica ?? politicaDeOperacao;
    const agora = deps.agora ?? new Date();
    try {
      const ctx = await resolverTenant(c, agora);
      if (!metadados.papeis.includes(ctx.papel)) {
        throw new AcessoNegado('papel não permitido');
      }
      const decisao = await politica(ctx, metadados.capacidade);
      if (!decisao.permitido) {
        throw new AcessoNegado(decisao.motivo);
      }
      return { ok: true, dados: await handler(ctx, input, Object.freeze({ agora })) };
    } catch (e) {
      if (ehErroDeDominio(e)) {
        return { ok: false, erro: e.codigo, status: e.status };
      }
      throw e;
    }
  }

  const acao = async (input: I): Promise<ResultadoAcao<O>> =>
    executar(await lerCredencialDoCookie(), input);

  Object.defineProperty(acao, 'executar', { value: executar, enumerable: false });
  Object.defineProperty(acao, METADADOS_ACAO, { value: metadados, enumerable: false });
  return acao as Acao<I, O>;
}

/** Metadados de uma ação, ou undefined se o valor não passou por `defineAcao`. */
export function metadadosDaAcao(v: unknown): Readonly<ConfigAcao> | undefined {
  if (typeof v !== 'function') {
    return undefined;
  }
  return (v as unknown as Partial<Record<typeof METADADOS_ACAO, Readonly<ConfigAcao>>>)[
    METADADOS_ACAO
  ];
}
