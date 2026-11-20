// Estado do formulário de /redefinir-senha (D-012 §3.4, D-18). Sem imports de servidor: usado pelo
// cliente (FormularioRedefinir) e pela ação (acoes.ts). NUNCA contém a senha nem o token.

export type StatusRedefinir = 'inicial' | 'formulario' | 'recusado' | 'sucesso';

export type EstadoRedefinir = {
  /** 'inicial' = nenhuma ação ainda: vale o veredito da página (prop `verificacao`). */
  status: StatusRedefinir;
  /** Mensagem geral: sucesso, recusa ou falha inesperada. */
  mensagem: string | null;
  /** Erro de validação do campo "Nova senha". */
  erroSenha: string | null;
};

export const ESTADO_INICIAL_REDEFINIR: EstadoRedefinir = Object.freeze({
  status: 'inicial',
  mensagem: null,
  erroSenha: null,
}) as EstadoRedefinir;
