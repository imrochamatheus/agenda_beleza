// Estado do formulário de /cadastro (D-011 §3.6). Sem imports de servidor: usado pelo cliente
// (FormularioCadastro) e pela ação (acoes.ts). Nunca guarda a senha.

export type CampoDoCadastro = 'nome' | 'email' | 'senha' | 'nomeSalao';

export type EstadoCadastro = {
  /** 'sucesso' troca o formulário pelo painel "Verifique seu e-mail". */
  status: 'editando' | 'sucesso';
  /** Erro geral (e-mail já cadastrado, falha inesperada). */
  mensagem: string | null;
  /** O erro é "e-mail já cadastrado": a tela mostra os links para entrar e para o reenvio. */
  emailExistente: boolean;
  /** Erros por campo (RN-7). */
  erros: Partial<Record<CampoDoCadastro, string>>;
  /** Valores devolvidos aos campos após um erro (aparados e cortados nos tetos). No sucesso, `email` é o normalizado. */
  valores: { nome: string; email: string; nomeSalao: string };
  /** RN-15: o cadastro foi gravado, mas o e-mail não saiu. */
  avisoEnvio: string | null;
};

export const ESTADO_INICIAL_CADASTRO: EstadoCadastro = Object.freeze({
  status: 'editando',
  mensagem: null,
  emailExistente: false,
  erros: Object.freeze({}),
  valores: Object.freeze({ nome: '', email: '', nomeSalao: '' }),
  avisoEnvio: null,
}) as EstadoCadastro;
