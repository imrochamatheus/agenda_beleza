import { createHash } from 'node:crypto';

import { z } from 'zod';

import { ROTAS } from '@/config/navegacao';
import { validarEnv } from '@/server/env';
import type { MensagemEmail, PortaEmail } from '@/server/integrations/email/port';
import { integracoes } from '@/server/integrations/registry';
import { incrementarJanela } from '@/server/repos/rate-limit';
import {
  buscarAlvoPorEmail,
  buscarAlvoPorTokenHash,
  consumirTokenConfirmacao,
  substituirTokenConfirmacao,
} from '@/server/repos/token-confirmacao';
import type { AlvoReenvio, ResultadoConsumo } from '@/server/repos/token-confirmacao';
import { hashDoToken } from '@/server/tenant/sessao';

import { inicioDaJanela } from './login';
import { gerarToken } from './sessao';

// Confirmação de e-mail do gestor (D-011 §3.3; RN-12..RN-15, RN-19). Pré-autenticação: não é
// defineAcao nem arquivo *.acao.ts. Sem next/*. O banco guarda só o SHA-256 do token; o valor em
// claro existe apenas no link enviado. O e-mail sai pela porta do registro (adaptador), depois do
// commit, e a falha no envio nunca desfaz o que foi gravado.

export type { ResultadoConsumo };

/** Validade do link (RN-5, RN-12). */
export const VALIDADE_CONFIRMACAO_MS = 24 * 60 * 60 * 1000;
/** Pedidos de reenvio por e-mail numa janela fixa de 15 min (JANELA_MS do login; D-4). */
export const LIMITE_REENVIO = 3;
/** 32 bytes em base64url (gerarToken de auth/sessao.ts). */
export const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const ASSUNTO_CONFIRMACAO = 'Confirme seu e-mail no Agenda Beleza';

export const MENSAGENS_CONFIRMACAO = Object.freeze({
  confirmado: 'E-mail confirmado. Agora você já pode entrar.',
  jaUtilizado: 'Este link já foi utilizado. Seu e-mail já está confirmado: você pode entrar.',
  expirado: 'Este link expirou ou foi substituído por um mais recente.',
  invalido: 'Link de confirmação inválido.',
  reenvioUniforme:
    'Se houver um cadastro aguardando confirmação para este e-mail, enviamos um novo link. Ele vale por 24 horas.',
  reenvioLimite: 'Muitas solicitações. Aguarde alguns minutos e tente de novo.',
  emailInvalido: 'Informe um e-mail válido.',
});

/** Mesmo esquema de e-mail do login e do cadastro (RN-7). */
export const esquemaEmail = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Token novo, seu hash (o que vai para o banco) e expira_em = agora + 24 h. */
export function novoTokenDeConfirmacao(
  agora: Date,
  gerar: () => string = gerarToken,
): { token: string; tokenHash: string; expiraEm: Date } {
  const token = gerar();
  return { token, tokenHash: hashDoToken(token), expiraEm: new Date(agora.getTime() + VALIDADE_CONFIRMACAO_MS) };
}

/** Link absoluto montado com APP_URL (RN-12): nunca com o Host da requisição. */
export function linkDeConfirmacao(appUrl: string, token: string): string {
  const url = new URL(ROTAS.confirmarEmail, appUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

/** Texto puro pt-BR com nome do gestor, nome do salão, link e a validade de 24 horas. Sem html. */
export function montarEmailConfirmacao(d: {
  para: string;
  nomeGestor: string;
  nomeSalao: string | null;
  link: string;
}): MensagemEmail {
  const cadastro = d.nomeSalao === null ? 'o seu cadastro' : `o cadastro do salão "${d.nomeSalao}"`;
  const texto = [
    `Olá, ${d.nomeGestor}!`,
    '',
    `Recebemos ${cadastro} no Agenda Beleza. Para confirmar o seu e-mail, abra o link abaixo:`,
    '',
    d.link,
    '',
    'O link vale por 24 horas e só pode ser usado uma vez.',
    'Se você não fez este cadastro, ignore esta mensagem.',
    '',
  ].join('\n');
  return { para: d.para, assunto: ASSUNTO_CONFIRMACAO, texto };
}

/** Chave do limite de reenvio: 'reenvio-confirmacao:' + SHA-256 do e-mail normalizado (sem o e-mail em claro). */
export function chaveDeReenvio(emailNormalizado: string): string {
  return `reenvio-confirmacao:${createHash('sha256').update(emailNormalizado, 'utf8').digest('hex')}`;
}

/**
 * Envia e devolve 'enviado' | 'falhou'. Captura ErroEnvioEmail, ErroValidacaoEmail e QUALQUER outro
 * erro do adaptador, sem relançar (RN-15): o cadastro ou o reenvio já estão gravados.
 */
export async function enviarEmailDeConfirmacao(porta: PortaEmail, m: MensagemEmail): Promise<'enviado' | 'falhou'> {
  try {
    await porta.enviar(m);
    return 'enviado';
  } catch {
    return 'falhou';
  }
}

/**
 * Monta o link (APP_URL) e o e-mail e envia pela porta do registro (ou `deps.email`). Usado pelo
 * cadastro e pelo reenvio DEPOIS do commit. Qualquer falha (ambiente, adaptador) vira 'falhou',
 * nunca exceção: o que foi gravado continua valendo (RN-15).
 */
export async function enviarLinkDeConfirmacao(
  deps: Pick<DepsConfirmacao, 'email' | 'appUrl'>,
  d: { para: string; nomeGestor: string; nomeSalao: string | null; token: string },
): Promise<'enviado' | 'falhou'> {
  let porta: PortaEmail;
  let appUrl: string;
  try {
    porta = deps.email ?? integracoes().email;
    appUrl = deps.appUrl ?? validarEnv(process.env).APP_URL;
  } catch {
    return 'falhou';
  }
  return enviarEmailDeConfirmacao(
    porta,
    montarEmailConfirmacao({
      para: d.para,
      nomeGestor: d.nomeGestor,
      nomeSalao: d.nomeSalao,
      link: linkDeConfirmacao(appUrl, d.token),
    }),
  );
}

export type DepsConfirmacao = {
  /** Relógio (testes). */
  agora?: Date;
  /** Porta de e-mail; padrão integracoes().email. */
  email?: PortaEmail;
  /** Padrão validarEnv(process.env).APP_URL. */
  appUrl?: string;
  /** Padrão gerarToken de auth/sessao.ts. */
  gerarToken?: () => string;
  /** Saída de log (padrão console.info). Nunca recebe e-mail, senha, token nem hash. */
  log?: (linha: string) => void;
};

/** Linha JSON de log sem dados pessoais (RN-19). */
export function registrarLog(
  deps: Pick<DepsConfirmacao, 'log'>,
  evento: string,
  agora: Date,
  campos: { resultado: string; salaoId?: string; usuarioId?: string; detalhe?: string },
): void {
  (deps.log ?? console.info)(JSON.stringify({ evento, ...campos, em: agora.toISOString() }));
}

/**
 * RN-13. Token não-string, vazio ou fora de FORMATO_TOKEN → 'invalido' SEM consultar o banco
 * (CA-14). Caso contrário, consome o token pelo hash (uso único, atômico).
 */
export async function confirmarEmail(
  token: unknown,
  deps: Pick<DepsConfirmacao, 'agora' | 'log'> = {},
): Promise<ResultadoConsumo> {
  const agora = deps.agora ?? new Date();
  const resultado =
    typeof token === 'string' && FORMATO_TOKEN.test(token)
      ? await consumirTokenConfirmacao(hashDoToken(token), agora)
      : 'invalido';
  registrarLog(deps, 'auth.confirmacao_email', agora, { resultado });
  return resultado;
}

export type ResultadoReenvio =
  | { ok: true; mensagem: string }
  | { ok: false; motivo: 'validacao'; erros: { email: string } }
  | { ok: false; motivo: 'limite'; mensagem: string };

const UNIFORME: ResultadoReenvio = Object.freeze({ ok: true, mensagem: MENSAGENS_CONFIRMACAO.reenvioUniforme });
const LIMITE: ResultadoReenvio = Object.freeze({
  ok: false,
  motivo: 'limite',
  mensagem: MENSAGENS_CONFIRMACAO.reenvioLimite,
});

/** Conta o pedido na janela do e-mail; true = acima do limite. Todo pedido conta (sem decremento). */
async function excedeuLimite(emailNormalizado: string, agora: Date): Promise<boolean> {
  return (await incrementarJanela(chaveDeReenvio(emailNormalizado), inicioDaJanela(agora))) > LIMITE_REENVIO;
}

/**
 * RN-14. Por e-mail (formulário de reenvio e botão do login) ou por token (tela de link expirado ou
 * substituído). Só o gestor não confirmado recebe um novo link; a resposta é sempre a mesma
 * mensagem uniforme (não revela se o e-mail existe), exceto o limite de 3 pedidos por janela.
 */
export async function reenviarConfirmacao(
  alvo: { email: unknown } | { token: unknown },
  deps: DepsConfirmacao = {},
): Promise<ResultadoReenvio> {
  const agora = deps.agora ?? new Date();
  const log = (resultado: string, usuarioId?: string) =>
    registrarLog(deps, 'auth.reenvio_confirmacao', agora, {
      resultado,
      ...(usuarioId === undefined ? {} : { usuarioId }),
    });

  let encontrado: AlvoReenvio | null;
  if ('token' in alvo) {
    const token = alvo.token;
    if (typeof token !== 'string' || !FORMATO_TOKEN.test(token)) {
      log('ignorado');
      return UNIFORME;
    }
    encontrado = await buscarAlvoPorTokenHash(hashDoToken(token));
    // Token desconhecido: não há e-mail para a chave do limite; nada é gravado.
    if (encontrado === null) {
      log('ignorado');
      return UNIFORME;
    }
    if (await excedeuLimite(encontrado.email, agora)) {
      log('limite');
      return LIMITE;
    }
  } else {
    const email = esquemaEmail.safeParse(alvo.email);
    if (!email.success) {
      log('validacao');
      return { ok: false, motivo: 'validacao', erros: { email: MENSAGENS_CONFIRMACAO.emailInvalido } };
    }
    if (await excedeuLimite(email.data, agora)) {
      log('limite');
      return LIMITE;
    }
    encontrado = await buscarAlvoPorEmail(email.data);
  }

  if (encontrado === null || encontrado.papel !== 'gestor' || encontrado.confirmado) {
    log('ignorado');
    return UNIFORME;
  }

  const { token, tokenHash, expiraEm } = novoTokenDeConfirmacao(agora, deps.gerarToken);
  const emitido = await substituirTokenConfirmacao({ usuarioId: encontrado.usuarioId, tokenHash, expiraEm, agora });
  if (emitido !== 'emitido') {
    // Corrida com o consumo: o usuário confirmou entre a busca e a trava.
    log('ignorado', encontrado.usuarioId);
    return UNIFORME;
  }

  const envio = await enviarLinkDeConfirmacao(deps, {
    para: encontrado.email,
    nomeGestor: encontrado.nome,
    nomeSalao: encontrado.nomeSalao,
    token,
  });
  log(envio === 'enviado' ? 'enviado' : 'envio_falhou', encontrado.usuarioId);
  return UNIFORME;
}
