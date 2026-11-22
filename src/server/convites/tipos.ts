// Contratos do convite de profissional (D-039 §3). Arquivo SEM imports de servidor: os componentes
// cliente o importam (só tipos e constantes). Resultados de negócio são discriminados por `resultado`
// dentro de `{ ok: true, dados }`; ErroDeDominio/ResultadoAcao seguem só com 401/403/404.

export type EntradaConvidar = { id: unknown };

export type CampoConvite = 'email' | 'formulario';
export type ErrosConvite = Partial<Record<CampoConvite, string>>;

export type ResultadoConvidar =
  | { resultado: 'criado'; emailEnviado: boolean; expiraEm: string }
  | { resultado: 'invalido'; erros: ErrosConvite }
  | { resultado: 'limite' };

/** Estado exibido ao gestor (CA-16). Nunca carrega token nem hash. */
export type EstadoConvite = 'sem_convite' | 'pendente' | 'expirado' | 'aceito';
export type EstadoConviteVisao = {
  estado: EstadoConvite;
  /** dd/mm/aaaa no fuso do salão (src/lib/format.ts) quando pendente ou expirado; senão null. */
  ate: string | null;
};

export const SEM_CONVITE: EstadoConviteVisao = Object.freeze({ estado: 'sem_convite', ate: null }) as EstadoConviteVisao;

export const MENSAGENS_CONVITE = Object.freeze({
  // Página pública: uma única recusa para inválido, expirado, usado ou substituído (RN-10).
  recusado: 'Este convite é inválido, expirou ou já foi usado. Peça ao gestor do salão um novo convite.',
  sucesso: 'Senha definida. Entre com o seu e-mail.',
  senhaCurta: 'A senha precisa ter pelo menos 8 caracteres.',
  senhaLonga: 'A senha pode ter no máximo 1024 caracteres.',
  falha: 'Não foi possível concluir. Tente de novo.',
  // Gestor.
  emailEmUso:
    'Este e-mail já está em uso por um usuário do Agenda Beleza e não pode ser convidado. Use outro e-mail.',
  jaTemAcesso: 'Este profissional já tem acesso.',
  inativo: 'Reative o profissional para convidar.',
  semEmail: 'Informe o e-mail do profissional e salve antes de enviar o convite.',
  limite: 'Muitos envios. Aguarde alguns minutos.',
  enviado: 'Convite enviado. O link vale por 7 dias.',
  emailNaoEnviado: 'Convite criado, mas o e-mail não foi enviado. Use Reenviar.',
  naoEncontrado: 'Profissional não encontrado.',
  acessoNegado: 'Acesso negado.',
});
