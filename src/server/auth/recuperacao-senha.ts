import { createHash } from 'node:crypto';

import { ROTAS } from '@/config/navegacao';
import { validarEnv } from '@/server/env';
import type { MensagemEmail, PortaEmail } from '@/server/integrations/email/port';
import { integracoes } from '@/server/integrations/registry';
import { incrementarJanela } from '@/server/repos/rate-limit';
import {
  buscarAlvoRecuperacao,
  buscarTokenRecuperacao,
  emitirTokenRecuperacao,
  redefinirSenhaComToken,
} from '@/server/repos/token-recuperacao';
import type { PerfilElegibilidade, ResultadoRedefinicaoRepo, TokenRecuperacao } from '@/server/repos/token-recuperacao';
import { hashDoToken } from '@/server/tenant/sessao';

import { FORMATO_TOKEN, enviarEmailDeConfirmacao, esquemaEmail } from './confirmacao-email';
import { chaveDeLogin, inicioDaJanela } from './login';
import { gerarHashSenha } from './senha';
import { gerarToken } from './sessao';

// Recuperação de senha da equipe (D-012 §3.3; RN-1..RN-17). Pré-autenticação: não é defineAcao nem
// arquivo *.acao.ts. Sem next/*: a casca injeta `after()` por `deps.agendar` (D-4). O banco guarda
// só o SHA-256 do token; o valor em claro existe apenas no link enviado. O e-mail sai pela porta do
// registro (adaptador), e a falha no envio nunca desfaz o token nem muda a resposta (RN-9, D-15).

export type { PerfilElegibilidade };

/** Validade do link (RN-5). */
export const VALIDADE_RECUPERACAO_MS = 60 * 60 * 1000;
/** Pedidos por e-mail numa janela fixa de 15 min (JANELA_MS do login; RN-8, D-5). */
export const LIMITE_SOLICITACOES = 3;
export const ASSUNTO_RECUPERACAO = 'Redefinição de senha no Agenda Beleza';

export const MENSAGENS_RECUPERACAO = Object.freeze({
  uniforme: 'Se houver uma conta com este e-mail, enviamos um link para redefinir a senha. Ele vale por 1 hora.',
  limite: 'Muitas solicitações. Aguarde alguns minutos e tente de novo.',
  emailInvalido: 'Informe um e-mail válido.',
  recusado: 'Este link de redefinição é inválido, expirou ou já foi usado. Peça um novo link.',
  sucesso: 'Sua senha foi alterada. Entre com a nova senha.',
  senhaCurta: 'A senha precisa ter pelo menos 8 caracteres.',
  senhaLonga: 'A senha pode ter no máximo 1024 caracteres.',
  falha: 'Não foi possível redefinir a senha. Tente de novo.',
});

const SENHA_MIN = 8;
const SENHA_MAX = 1024;

// ---------------------------------------------------------------------------------------------
// Funções puras
// ---------------------------------------------------------------------------------------------

/** RN-6, D-2: gestor (confirmado ou não; com ou sem perfil) ou profissional com perfil ativo. */
export function elegivelParaRecuperacao(u: PerfilElegibilidade): boolean {
  return u.papel === 'gestor' || (u.papel === 'profissional' && u.profissionalAtivo === true);
}

/** RN-5: válido sse não usado, não invalidado e agora < expiraEm. "Usado" tem precedência no motivo. */
export function estadoDoToken(
  t: { usadoEm: Date | null; invalidadoEm: Date | null; expiraEm: Date },
  agora: Date,
): 'valido' | 'ja_utilizado' | 'expirado_ou_substituido' {
  if (t.usadoEm !== null) {
    return 'ja_utilizado';
  }
  if (t.invalidadoEm !== null || agora.getTime() >= t.expiraEm.getTime()) {
    return 'expirado_ou_substituido';
  }
  return 'valido';
}

/** Token novo, seu hash (o que vai para o banco) e expira_em = agora + 1 h. */
export function novoTokenDeRecuperacao(
  agora: Date,
  gerar: () => string = gerarToken,
): { token: string; tokenHash: string; expiraEm: Date } {
  const token = gerar();
  return { token, tokenHash: hashDoToken(token), expiraEm: new Date(agora.getTime() + VALIDADE_RECUPERACAO_MS) };
}

/** Link absoluto montado com APP_URL (RN-5): nunca com o Host da requisição. */
export function linkDeRedefinicao(appUrl: string, token: string): string {
  const url = new URL(ROTAS.redefinirSenha, appUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

/** Texto puro pt-BR (RN-9): nome, link, validade de 1 hora, uso único, saída de todos os dispositivos. */
export function montarEmailRecuperacao(d: { para: string; nome: string; link: string }): MensagemEmail {
  const texto = [
    `Olá, ${d.nome}!`,
    '',
    'Recebemos um pedido para redefinir a sua senha no Agenda Beleza. Para definir uma nova senha, abra o link abaixo:',
    '',
    d.link,
    '',
    'O link vale por 1 hora e só pode ser usado uma vez.',
    'Ao definir a nova senha, você sai de todos os dispositivos em que a sua conta estiver aberta.',
    '',
    'Se você não pediu, ignore esta mensagem: sua senha atual continua valendo.',
    '',
  ].join('\n');
  return { para: d.para, assunto: ASSUNTO_RECUPERACAO, texto };
}

/** Chave do limite: 'recuperacao-senha:' + SHA-256 do e-mail normalizado (sem o e-mail em claro). */
export function chaveDeRecuperacao(emailNormalizado: string): string {
  return `recuperacao-senha:${createHash('sha256').update(emailNormalizado, 'utf8').digest('hex')}`;
}

/** RN-11: a senha não é aparada nem normalizada; 8..1024 caracteres (string.length). */
export function validarNovaSenha(v: unknown): { ok: true; senha: string } | { ok: false; erro: string } {
  if (typeof v !== 'string' || v.length < SENHA_MIN) {
    return { ok: false, erro: MENSAGENS_RECUPERACAO.senhaCurta };
  }
  if (v.length > SENHA_MAX) {
    return { ok: false, erro: MENSAGENS_RECUPERACAO.senhaLonga };
  }
  return { ok: true, senha: v };
}

// ---------------------------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------------------------

export type DepsRecuperacao = {
  /** Relógio (testes). */
  agora?: Date;
  /** Porta de e-mail; padrão integracoes().email (resolvida DENTRO da tarefa, com try). */
  email?: PortaEmail;
  /** Padrão validarEnv(process.env).APP_URL (idem). */
  appUrl?: string;
  /** Padrão gerarToken de auth/sessao.ts. */
  gerarToken?: () => string;
  /** Padrão gerarHashSenha (argon2id). */
  hashSenha?: (senha: string) => Promise<string>;
  /** Saída de log (padrão console.info). Nunca recebe e-mail, senha, token nem hash. */
  log?: (linha: string) => void;
  /**
   * D-4. Recebe a tarefa adiada (busca, emissão e envio). Padrão: executa e aguarda inline. A casca
   * passa `after` de next/server, para a resposta não esperar o banco nem o SMTP.
   */
  agendar?: (tarefa: () => Promise<void>) => void | Promise<void>;
};

type CamposLog = { resultado: string; detalhe?: string; usuarioId?: string; sessoesRevogadas?: number };

/** Linha JSON de log sem dados pessoais (RN-15). */
function registrar(deps: Pick<DepsRecuperacao, 'log'>, evento: string, agora: Date, campos: CamposLog): void {
  (deps.log ?? console.info)(JSON.stringify({ evento, ...campos, em: agora.toISOString() }));
}

export type ResultadoSolicitacao =
  | { ok: true; mensagem: string }
  | { ok: false; motivo: 'validacao'; erros: { email: string } }
  | { ok: false; motivo: 'limite'; mensagem: string };

const executarInline = (tarefa: () => Promise<void>) => tarefa();

/**
 * Tarefa adiada da solicitação (D-4): busca, emissão e envio. Nunca lança: qualquer erro vira log
 * (`envio_falhou` para ambiente/adaptador, `falha` para o resto).
 */
async function emitirEEnviar(email: string, agora: Date, deps: DepsRecuperacao): Promise<void> {
  const log = (resultado: string, usuarioId?: string) =>
    registrar(deps, 'auth.recuperacao_senha', agora, { resultado, ...(usuarioId === undefined ? {} : { usuarioId }) });
  try {
    const alvo = await buscarAlvoRecuperacao(email);
    if (alvo === null || !elegivelParaRecuperacao(alvo)) {
      log('ignorado');
      return;
    }
    const { token, tokenHash, expiraEm } = novoTokenDeRecuperacao(agora, deps.gerarToken);
    const emitido = await emitirTokenRecuperacao({
      usuarioId: alvo.usuarioId,
      tokenHash,
      expiraEm,
      agora,
      elegivel: elegivelParaRecuperacao,
    });
    if (emitido !== 'emitido') {
      // Corrida: o usuário deixou de ser elegível entre a busca e a trava.
      log('ignorado', alvo.usuarioId);
      return;
    }
    // Ambiente sem adaptador válido ou APP_URL inválida: o token fica gravado; a pessoa pede de novo.
    let porta: PortaEmail;
    let mensagem: MensagemEmail;
    try {
      porta = deps.email ?? integracoes().email;
      const appUrl = deps.appUrl ?? validarEnv(process.env).APP_URL;
      mensagem = montarEmailRecuperacao({ para: alvo.email, nome: alvo.nome, link: linkDeRedefinicao(appUrl, token) });
    } catch {
      log('envio_falhou', alvo.usuarioId);
      return;
    }
    const envio = await enviarEmailDeConfirmacao(porta, mensagem);
    log(envio === 'enviado' ? 'enviado' : 'envio_falhou', alvo.usuarioId);
  } catch {
    log('falha');
  }
}

/**
 * RN-4, RN-7, RN-8, RN-9. Caminho síncrono idêntico para todo e-mail válido: validação + incremento
 * do limite. Tudo o que depende de o e-mail existir vai para a tarefa adiada (`deps.agendar`). A
 * resposta é sempre a uniforme, exceto validação e limite (que também não revelam existência).
 */
export async function solicitarRecuperacao(
  entrada: { email: unknown },
  deps: DepsRecuperacao = {},
): Promise<ResultadoSolicitacao> {
  const agora = deps.agora ?? new Date();
  const email = esquemaEmail.safeParse(entrada.email);
  if (!email.success) {
    registrar(deps, 'auth.recuperacao_senha', agora, { resultado: 'validacao' });
    return { ok: false, motivo: 'validacao', erros: { email: MENSAGENS_RECUPERACAO.emailInvalido } };
  }
  if ((await incrementarJanela(chaveDeRecuperacao(email.data), inicioDaJanela(agora))) > LIMITE_SOLICITACOES) {
    registrar(deps, 'auth.recuperacao_senha', agora, { resultado: 'limite' });
    return { ok: false, motivo: 'limite', mensagem: MENSAGENS_RECUPERACAO.limite };
  }
  const agendar = deps.agendar ?? executarInline;
  await agendar(() => emitirEEnviar(email.data, agora, deps));
  return { ok: true, mensagem: MENSAGENS_RECUPERACAO.uniforme };
}

export type MotivoRecusa = 'invalido' | 'ja_utilizado' | 'expirado_ou_substituido' | 'inelegivel';
export type ResultadoVerificacao = { ok: true } | { ok: false; motivo: MotivoRecusa };

/** Token de formato válido (sem banco). */
const formatoValido = (t: unknown): t is string => typeof t === 'string' && FORMATO_TOKEN.test(t);

/** Lê o token (sem trava, sem escrita) e aplica validade e elegibilidade. */
async function lerToken(
  token: string,
  agora: Date,
): Promise<{ ok: true; t: TokenRecuperacao } | { ok: false; motivo: MotivoRecusa }> {
  const t = await buscarTokenRecuperacao(hashDoToken(token));
  if (t === null) {
    return { ok: false, motivo: 'invalido' };
  }
  const estado = estadoDoToken(t, agora);
  if (estado !== 'valido') {
    return { ok: false, motivo: estado };
  }
  if (!elegivelParaRecuperacao(t)) {
    return { ok: false, motivo: 'inelegivel' };
  }
  return { ok: true, t };
}

/** RN-10, D-1. GET do link: só verifica (nunca consome nem grava). */
export async function verificarLinkDeRedefinicao(
  token: unknown,
  deps: Pick<DepsRecuperacao, 'agora' | 'log'> = {},
): Promise<ResultadoVerificacao> {
  const agora = deps.agora ?? new Date();
  const r: ResultadoVerificacao = formatoValido(token)
    ? await lerToken(token, agora).then((x) => (x.ok ? { ok: true as const } : x))
    : { ok: false, motivo: 'invalido' };
  registrar(deps, 'auth.redefinicao_senha_link', agora, r.ok ? { resultado: 'valido' } : { resultado: 'recusado', detalhe: r.motivo });
  return r;
}

export type ResultadoRedefinicao =
  | { ok: true; mensagem: string }
  | { ok: false; motivo: 'validacao'; erros: { senha: string } }
  | { ok: false; motivo: 'recusado'; detalhe: MotivoRecusa; mensagem: string }
  | { ok: false; motivo: 'falha'; mensagem: string };

/**
 * RN-11, RN-12, RN-3. Ordem: formato do token e senha (sem banco) → leitura do token (recusa sem
 * hash) → argon2 fora da transação → transação (consumo, hash, invalidações, revogação das sessões,
 * janela do login). Recusa por corrida vem do repositório; erro de banco vira 'falha' sem efeito.
 */
export async function redefinirSenha(
  entrada: { token: unknown; senha: unknown },
  deps: DepsRecuperacao = {},
): Promise<ResultadoRedefinicao> {
  const agora = deps.agora ?? new Date();
  const log = (campos: CamposLog) => registrar(deps, 'auth.redefinicao_senha', agora, campos);
  const recusa = (detalhe: MotivoRecusa): ResultadoRedefinicao => {
    log({ resultado: 'recusado', detalhe });
    return { ok: false, motivo: 'recusado', detalhe, mensagem: MENSAGENS_RECUPERACAO.recusado };
  };

  if (!formatoValido(entrada.token)) {
    return recusa('invalido');
  }
  const senha = validarNovaSenha(entrada.senha);
  if (!senha.ok) {
    log({ resultado: 'validacao' });
    return { ok: false, motivo: 'validacao', erros: { senha: senha.erro } };
  }
  const lido = await lerToken(entrada.token, agora);
  if (!lido.ok) {
    return recusa(lido.motivo);
  }

  let r: ResultadoRedefinicaoRepo;
  try {
    const senhaHash = await (deps.hashSenha ?? gerarHashSenha)(senha.senha);
    r = await redefinirSenhaComToken({
      tokenHash: hashDoToken(entrada.token),
      senhaHash,
      agora,
      chaveLogin: chaveDeLogin(lido.t.email),
      janelaLogin: inicioDaJanela(agora),
      elegivel: elegivelParaRecuperacao,
    });
  } catch {
    log({ resultado: 'falha' });
    return { ok: false, motivo: 'falha', mensagem: MENSAGENS_RECUPERACAO.falha };
  }
  if (r.resultado !== 'redefinido') {
    return recusa(r.resultado);
  }
  log({ resultado: 'ok', usuarioId: r.usuarioId, sessoesRevogadas: r.sessoesRevogadas });
  return { ok: true, mensagem: MENSAGENS_RECUPERACAO.sucesso };
}
