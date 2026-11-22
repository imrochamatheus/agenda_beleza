// Estado do formulário "Assinar" (D-040). Client-safe. O resultado volta no estado, sem PRG: funciona sem JS.

export type EstadoAssinar = { mensagem: string | null; sucesso: boolean };

export const ESTADO_ASSINAR_INICIAL: EstadoAssinar = { mensagem: null, sucesso: false };
