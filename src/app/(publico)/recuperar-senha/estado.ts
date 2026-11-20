// Estado do formulário de /recuperar-senha (D-012 §3.4). Sem imports de servidor: usado pelo
// cliente (FormularioRecuperar) e pela ação (acoes.ts). A estrutura é a mesma para e-mail existente
// ou não (RN-1, RN-7).

export type EstadoRecuperar = {
  /** Resposta uniforme (sucesso) ou limite (erro). */
  mensagem: string | null;
  variante: 'sucesso' | 'erro' | null;
  /** Erro de validação do campo e-mail. */
  erroEmail: string | null;
  /** E-mail digitado, devolvido ao campo (aparado, até 254 caracteres). */
  email: string;
};

export const ESTADO_INICIAL_RECUPERAR: EstadoRecuperar = Object.freeze({
  mensagem: null,
  variante: null,
  erroEmail: null,
  email: '',
}) as EstadoRecuperar;
