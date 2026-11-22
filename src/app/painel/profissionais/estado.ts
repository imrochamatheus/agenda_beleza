// Estados dos formulários de /painel/profissionais (D-013 §3.6). Sem imports de servidor de runtime:
// só `import type` e as constantes de @/server/profissionais/tipos (arquivo sem dependências).
import type { ErrosProfissional, ReservaBloqueante } from '@/server/profissionais/tipos';

export type EstadoFormularioProfissional = {
  /** Erro geral (acesso negado, profissional não encontrado). */
  mensagem: string | null;
  /** Erros por campo (RN-9). */
  erros: ErrosProfissional;
  /** Valores devolvidos aos campos depois de um erro (aparados e cortados nos tetos). */
  valores: { nome: string; email: string };
};

export const ESTADO_INICIAL_FORMULARIO: EstadoFormularioProfissional = Object.freeze({
  mensagem: null,
  erros: Object.freeze({}),
  valores: Object.freeze({ nome: '', email: '' }),
}) as EstadoFormularioProfissional;

export type EstadoEuTambemAtendo = {
  /** 'info' = já atende; 'sucesso' = perfil criado/reativado; 'erro' = recusa de acesso. */
  variante: 'info' | 'sucesso' | 'erro' | null;
  mensagem: string | null;
};

export const ESTADO_INICIAL_EU_TAMBEM_ATENDO: EstadoEuTambemAtendo = Object.freeze({
  variante: null,
  mensagem: null,
}) as EstadoEuTambemAtendo;

export type EstadoDesativacao =
  | { status: 'ocioso' }
  | { status: 'desativado' }
  | { status: 'recusado'; reservas: ReservaBloqueante[] }
  | { status: 'erro'; mensagem: string };

export const ESTADO_INICIAL_DESATIVACAO: EstadoDesativacao = Object.freeze({ status: 'ocioso' }) as EstadoDesativacao;

/** Resultado do formulário "Enviar/Reenviar convite" (D-039). `aviso` = convite criado, e-mail não enviado. */
export type EstadoConviteProfissional = {
  variante: 'sucesso' | 'aviso' | 'erro' | null;
  mensagem: string | null;
};

export const ESTADO_INICIAL_CONVITE_PROFISSIONAL: EstadoConviteProfissional = Object.freeze({
  variante: null,
  mensagem: null,
}) as EstadoConviteProfissional;
