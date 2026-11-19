/**
 * Erros de domínio da camada de escopo (S-3). As mensagens e o corpo HTTP são CONSTANTES: nenhum
 * construtor recebe ID, nome ou qualquer valor do recurso (CA-1 "nenhum dado de B", CA-8 "mesmo corpo").
 */
export type CodigoErro = 'nao_autenticado' | 'acesso_negado' | 'nao_encontrado';
export type StatusErro = 401 | 403 | 404;

export abstract class ErroDeDominio extends Error {
  abstract readonly codigo: CodigoErro;
  abstract readonly status: StatusErro;
}

/** Sem sessão, token desconhecido, sessão expirada ou revogada → 401. */
export class NaoAutenticado extends ErroDeDominio {
  readonly codigo = 'nao_autenticado' as const;
  readonly status = 401 as const;

  constructor() {
    super('Não autenticado');
    this.name = 'NaoAutenticado';
  }
}

/**
 * Sessão válida sem permissão (papel, política de operação, TOTP) → 403. O `motivo` é só para
 * diagnóstico interno (logs e testes): nunca vai para o corpo da resposta.
 */
export class AcessoNegado extends ErroDeDominio {
  readonly codigo = 'acesso_negado' as const;
  readonly status = 403 as const;
  readonly motivo: string | undefined;

  constructor(motivo?: string) {
    super('Acesso negado');
    this.name = 'AcessoNegado';
    this.motivo = motivo;
  }
}

/** Recurso inexistente, de outro salão ou com ID malformado: resposta única (RN-2, RN-9) → 404. */
export class NaoEncontrado extends ErroDeDominio {
  readonly codigo = 'nao_encontrado' as const;
  readonly status = 404 as const;

  constructor() {
    super('Recurso não encontrado');
    this.name = 'NaoEncontrado';
  }
}

export function ehErroDeDominio(e: unknown): e is ErroDeDominio {
  return e instanceof ErroDeDominio;
}

/** Mapeamento erro → resposta HTTP. O corpo só traz o código. */
export function respostaDeErro(e: ErroDeDominio): {
  status: StatusErro;
  corpo: { erro: CodigoErro };
} {
  return { status: e.status, corpo: { erro: e.codigo } };
}
