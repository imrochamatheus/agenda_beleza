import { slugBase } from '@/lib/slug';
import { normalizarNome } from '@/lib/texto';
import { criarSalaoComGestor, emailJaCadastrado } from '@/server/repos/cadastro';

import { enviarLinkDeConfirmacao, esquemaEmail, novoTokenDeConfirmacao, registrarLog } from './confirmacao-email';
import type { DepsConfirmacao } from './confirmacao-email';
import { gerarHashSenha } from './senha';

// Cadastro do gestor e do salão (D-011 §3.4; RN-1..RN-7, RN-11, RN-15, RN-17, RN-19). Pré-autenticação:
// não é defineAcao nem arquivo *.acao.ts; sem next/*. O papel (gestor) e o salão nunca vêm do
// formulário. O hash argon2 é calculado ANTES da transação; o e-mail sai DEPOIS do commit.

export const MENSAGENS_CADASTRO = Object.freeze({
  nome: 'Informe seu nome (de 2 a 100 caracteres).',
  email: 'Informe um e-mail válido.',
  senhaCurta: 'A senha precisa ter pelo menos 8 caracteres.',
  senhaLonga: 'A senha pode ter no máximo 1024 caracteres.',
  nomeSalao: 'Informe o nome do salão (de 2 a 80 caracteres).',
  emailExistente: 'Este e-mail já está cadastrado. Entre ou, se ainda não confirmou o e-mail, peça um novo link.',
  falha: 'Não foi possível concluir o cadastro. Tente de novo.',
  avisoEnvio: "Não conseguimos enviar o e-mail agora. Use 'Reenviar link' em alguns minutos.",
});

/** Tetos da RN-7 (D-13). A casca usa os mesmos para não ecoar entradas enormes. */
export const LIMITES_CADASTRO = Object.freeze({
  nome: { min: 2, max: 100 },
  email: { max: 254 },
  senha: { min: 8, max: 1024 },
  nomeSalao: { min: 2, max: 80 },
});

export type CampoCadastro = 'nome' | 'email' | 'senha' | 'nomeSalao';
export type DadosCadastro = { nome: string; email: string; senha: string; nomeSalao: string };
export type ErrosCadastro = Partial<Record<CampoCadastro, string>>;

/** RN-7. Puro (unidade). Todos os erros juntos. A senha não é aparada nem normalizada. */
export function validarCadastro(
  e: Record<CampoCadastro, unknown>,
): { ok: true; dados: DadosCadastro } | { ok: false; erros: ErrosCadastro } {
  const erros: ErrosCadastro = {};
  const nome = normalizarNome(e.nome, LIMITES_CADASTRO.nome);
  if (nome === null) erros.nome = MENSAGENS_CADASTRO.nome;

  const email = esquemaEmail.safeParse(e.email);
  if (!email.success) erros.email = MENSAGENS_CADASTRO.email;

  const senha = e.senha;
  if (typeof senha !== 'string' || senha.length < LIMITES_CADASTRO.senha.min) {
    erros.senha = MENSAGENS_CADASTRO.senhaCurta;
  } else if (senha.length > LIMITES_CADASTRO.senha.max) {
    erros.senha = MENSAGENS_CADASTRO.senhaLonga;
  }

  const nomeSalao = normalizarNome(e.nomeSalao, LIMITES_CADASTRO.nomeSalao);
  if (nomeSalao === null) erros.nomeSalao = MENSAGENS_CADASTRO.nomeSalao;

  if (nome === null || !email.success || erros.senha || nomeSalao === null) {
    return { ok: false, erros };
  }
  return { ok: true, dados: { nome, email: email.data, senha: senha as string, nomeSalao } };
}

export type ResultadoCadastro =
  | { ok: true; email: string; envio: 'enviado' | 'falhou' }
  | { ok: false; motivo: 'validacao'; erros: ErrosCadastro }
  | { ok: false; motivo: 'email_existente'; erros: { email: string } }
  | { ok: false; motivo: 'falha'; mensagem: string };

export type DepsCadastro = DepsConfirmacao & {
  /** Padrão gerarHashSenha (testes instrumentam o número de chamadas). */
  hashSenha?: (senha: string) => Promise<string>;
};

/**
 * Ordem: validação (sem banco, sem hash, sem e-mail) → verificação prévia do e-mail → hash argon2id
 * → token → transação (salão, gestor, slug, token) → e-mail após o commit. Falha no envio não desfaz.
 */
export async function cadastrar(e: Record<CampoCadastro, unknown>, deps: DepsCadastro = {}): Promise<ResultadoCadastro> {
  const agora = deps.agora ?? new Date();
  const log = (resultado: string, extra: { salaoId?: string; usuarioId?: string; detalhe?: string } = {}) =>
    registrarLog(deps, 'auth.cadastro', agora, { resultado, ...extra });

  const v = validarCadastro(e);
  if (!v.ok) {
    log('validacao');
    return { ok: false, motivo: 'validacao', erros: v.erros };
  }
  const d = v.dados;
  const existente = { ok: false, motivo: 'email_existente', erros: { email: MENSAGENS_CADASTRO.emailExistente } } as const;

  if (await emailJaCadastrado(d.email)) {
    log('email_existente');
    return existente;
  }

  const falha = (detalhe: string): ResultadoCadastro => {
    log('falha', { detalhe });
    return { ok: false, motivo: 'falha', mensagem: MENSAGENS_CADASTRO.falha };
  };

  let r: Awaited<ReturnType<typeof criarSalaoComGestor>>;
  let token: string;
  try {
    const senhaHash = await (deps.hashSenha ?? gerarHashSenha)(d.senha);
    const t = novoTokenDeConfirmacao(agora, deps.gerarToken);
    token = t.token;
    r = await criarSalaoComGestor({
      nomeSalao: d.nomeSalao,
      slugBase: slugBase(d.nomeSalao),
      nomeGestor: d.nome,
      email: d.email,
      senhaHash,
      tokenHash: t.tokenHash,
      expiraEm: t.expiraEm,
      agora,
    });
  } catch (erro) {
    // Só o nome da classe vai para o log: a mensagem do driver pode conter valores.
    return falha(erro instanceof Error ? erro.name : 'desconhecido');
  }
  if (!r.ok) {
    if (r.motivo === 'email_existente') {
      log('email_existente');
      return existente;
    }
    return falha(r.motivo);
  }

  const envio = await enviarLinkDeConfirmacao(deps, {
    para: d.email,
    nomeGestor: d.nome,
    nomeSalao: d.nomeSalao,
    token,
  });
  log(envio === 'enviado' ? 'ok' : 'ok_envio_falhou', { salaoId: r.salaoId, usuarioId: r.usuarioId });
  return { ok: true, email: d.email, envio };
}
