// Contratos de entrada e resultado da gestão de profissionais (D-013 §3.4). Arquivo SEM imports de
// servidor: os componentes cliente o importam (só tipos e constantes). Os resultados de negócio são
// discriminados por `resultado` dentro de `{ ok: true, dados }` (D-14): ErroDeDominio/ResultadoAcao
// continuam só com 401/403/404.

export type CampoProfissional = 'nome' | 'email' | 'formulario';
export type ErrosProfissional = Partial<Record<CampoProfissional, string>>;
/** `voce` = perfil do próprio usuário da sessão; `com_acesso` = outro usuário vinculado. */
export type AcessoProfissional = 'voce' | 'com_acesso' | 'sem_acesso';

export type ProfissionalVisao = {
  id: string;
  nome: string;
  email: string | null;
  ativo: boolean;
  acesso: AcessoProfissional;
  /** E-mail de login (somente leitura) quando há usuário vinculado. */
  emailLogin: string | null;
  /** true se o e-mail do perfil não pode ser editado (RN-9: há usuário vinculado). */
  emailBloqueado: boolean;
};

export type EntradaCriar = { nome: unknown; email?: unknown };
export type EntradaEditar = { id: unknown; nome: unknown; email?: unknown };
export type EntradaId = { id: unknown };

export type ResultadoSalvar =
  | { resultado: 'salvo'; profissional: ProfissionalVisao }
  | { resultado: 'invalido'; erros: ErrosProfissional };

export type ReservaBloqueante = {
  /** Id da reserva. */
  id: string;
  /** Id do item (D-050 RN-38: uma linha por item; chave única da lista). */
  itemId: string;
  /** ISO UTC (serializável). */
  inicio: string;
  /** Data e hora de início no fuso do salão (src/lib/format.ts). */
  inicioLocal: string;
  servicos: string[];
  /** Nome da cliente, ou ROTULO_CLIENTE_REMOVIDA se anonimizada. */
  cliente: string;
};

export type ResultadoDesativar =
  | { resultado: 'desativado' }
  | { resultado: 'recusado'; reservas: ReservaBloqueante[] };
export type ResultadoReativar = { resultado: 'reativado' };
export type ResultadoEuTambemAtendo = {
  resultado: 'criado' | 'reativado' | 'ja_atende';
  profissionalId: string;
};

export const ROTULO_CLIENTE_REMOVIDA = 'cliente removida';

export const MENSAGENS_PROFISSIONAL = Object.freeze({
  nome: 'Informe o nome (de 2 a 100 caracteres).',
  email: 'Informe um e-mail válido ou deixe em branco.',
  emailBloqueado: 'O e-mail de quem já tem acesso não pode ser alterado aqui.',
  formulario: 'Não foi possível ler os dados enviados. Tente de novo.',
  recusaDesativacao: 'Não é possível desativar: há reservas futuras confirmadas. Remarque ou cancele antes.',
  jaAtende: 'Você já atende neste salão.',
  perfilAtivado: 'Pronto: agora você também atende neste salão.',
  naoEncontrado: 'Profissional não encontrado.',
  acessoNegado: 'Acesso negado.',
});
