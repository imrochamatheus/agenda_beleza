// Estado do formulário de /convite/[token] (D-039 §2). Sem imports de servidor: usado pelo cliente
// (FormularioConvite) e pela ação (acoes.ts). NUNCA contém a senha nem o token.

export type StatusConvite = 'inicial' | 'formulario' | 'recusado' | 'sucesso';

export type EstadoConvite = {
  /** 'inicial' = nenhuma ação ainda: vale o veredito da página (prop `verificacao`). */
  status: StatusConvite;
  /** Mensagem geral: sucesso, recusa ou falha inesperada. */
  mensagem: string | null;
  /** Erro de validação do campo "Senha". */
  erroSenha: string | null;
};

export const ESTADO_INICIAL_CONVITE: EstadoConvite = Object.freeze({
  status: 'inicial',
  mensagem: null,
  erroSenha: null,
}) as EstadoConvite;
