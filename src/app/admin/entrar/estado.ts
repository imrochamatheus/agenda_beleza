// Estado dos formulários de /admin/entrar (D-034). Sem imports de servidor: usado pelo cliente e
// pelas ações. Nunca guarda senha nem código.

export type EstadoAdmin = {
  /** Erro geral (credenciais, código inválido, limite). */
  mensagem: string | null;
  /** Erros de validação por campo. */
  erros: { email?: string; senha?: string; codigo?: string };
  /** E-mail digitado, devolvido ao campo após um erro. */
  email: string;
  /** Aviso informativo (só a vitrine /dev/admin-entrar o usa). */
  aviso?: string | null;
};

export const ESTADO_INICIAL_ADMIN: EstadoAdmin = Object.freeze({
  mensagem: null,
  erros: Object.freeze({}),
  email: '',
}) as EstadoAdmin;
