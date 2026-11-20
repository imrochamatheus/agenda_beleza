// Estado do formulário de reenvio do link de confirmação (D-011 §3.6). Sem imports de servidor:
// usado pelo cliente (FormularioReenvio) e pela ação (acoes.ts).

export type EstadoReenvio = {
  /** Resposta uniforme (sucesso) ou limite (erro). */
  mensagem: string | null;
  variante: 'sucesso' | 'erro' | null;
  /** Erro de validação do campo e-mail. */
  erroEmail: string | null;
  /** E-mail digitado, devolvido ao campo. */
  email: string;
};

export const ESTADO_INICIAL_REENVIO: EstadoReenvio = Object.freeze({
  mensagem: null,
  variante: null,
  erroEmail: null,
  email: '',
}) as EstadoReenvio;
