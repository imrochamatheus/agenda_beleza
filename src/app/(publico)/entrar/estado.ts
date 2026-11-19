// Estado do formulário de /entrar (D-010 §3.12). Sem imports de servidor: usado pelo cliente
// (FormularioEntrar) e pela ação (acoes.ts). Nunca guarda a senha.

export type EstadoEntrar = {
  /** Erro geral (credenciais, e-mail não confirmado, acesso desativado, limite). */
  mensagem: string | null;
  /** Erros de validação por campo. */
  erros: { email?: string; senha?: string };
  /** E-mail digitado, devolvido para o campo após um erro. */
  email: string;
};

export const ESTADO_INICIAL_ENTRAR: EstadoEntrar = Object.freeze({
  mensagem: null,
  erros: Object.freeze({}),
  email: '',
}) as EstadoEntrar;
