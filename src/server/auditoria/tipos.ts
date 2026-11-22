// Contratos e vocabulário da auditoria (D-033, E8.1). Client-safe: sem Prisma, sem next/*.

/** Ações auditáveis: `entidade.verbo` em snake_case. Novas demandas acrescentam aqui, por PR. */
export const ACOES_AUDITAVEIS = [
  'avaliacao.retirar',
  'avaliacao.restaurar',
  'salao.renomear',
  'login.falha_totp',
  'login.falha_senha',
  // D-034 (E1.5): sucesso do login do super admin e cadastro do TOTP (entidade `usuario`, sem antes/depois).
  'login.sucesso',
  'totp.cadastrar',
  // D-035 (E8.4): arquivar denúncias de avaliação sem retirar (entidade `avaliacao_denuncia`).
  'avaliacao.denuncia_resolver',
  // D-044 (E8.2): salões no painel do super admin. `salao.renomear` segue reservado e NÃO é usado (o nome
  // sai em `salao.atualizar`, só com os campos alterados). `usuario.atualizar_email` é do gestor.
  'salao.atualizar',
  'salao.suspender',
  'salao.reativar',
  'salao.estender_teste',
  'usuario.atualizar_email',
] as const;
export type AcaoAuditavel = (typeof ACOES_AUDITAVEIS)[number];

export const ENTIDADES_AUDITAVEIS = ['assinatura', 'avaliacao', 'avaliacao_denuncia', 'salao', 'usuario'] as const;
export type EntidadeAuditavel = (typeof ENTIDADES_AUDITAVEIS)[number];

/** Ações de "mutação com valor anterior e novo": `antes` e `depois` são obrigatórios em sucesso. */
export const ACOES_COM_ANTES_DEPOIS: readonly AcaoAuditavel[] = [
  'avaliacao.retirar',
  'avaliacao.restaurar',
  'salao.renomear',
  'salao.atualizar',
  'salao.suspender',
  'salao.reativar',
  'salao.estender_teste',
  'usuario.atualizar_email',
];

export const FORMATO_ACAO = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;

export const MAX_BYTES = 16384;
export const MAX_PROFUNDIDADE = 6;
export const MAX_ACAO = 64;
export const MAX_ENTIDADE_ID = 64;
export const MAX_EMAIL = 254;

export type JsonValor = string | number | boolean | null | JsonValor[] | { [chave: string]: JsonValor };
export type JsonObjeto = { [chave: string]: JsonValor };

/** Entrada inválida (vocabulário, formato, limites, JSON não puro). A mensagem nunca cita valores. */
export class ErroAuditoriaEntrada extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroAuditoriaEntrada';
  }
}

/** Chave suspeita de segredo. A mensagem traz só o caminho da chave, nunca o valor. */
export class ErroAuditoriaSegredo extends Error {
  readonly caminho: string;
  constructor(caminho: string) {
    super(`chave proibida em antes/depois: ${caminho}`);
    this.name = 'ErroAuditoriaSegredo';
    this.caminho = caminho;
  }
}

declare const validada: unique symbol;

/** Entrada já validada por `montarEntrada` (marca nominal: só nasce em registrar.ts). */
export type EntradaAuditoriaValidada = {
  readonly [validada]: true;
  readonly atorId: string | null;
  readonly atorEmailInformado: string | null;
  readonly acao: AcaoAuditavel;
  readonly entidade: EntidadeAuditavel | null;
  readonly entidadeId: string | null;
  readonly salaoId: string | null;
  readonly antes: JsonObjeto | null;
  readonly depois: JsonObjeto | null;
  readonly resultado: 'sucesso' | 'falha';
};
