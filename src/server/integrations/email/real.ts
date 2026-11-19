import { createTransport, type SMTPTransportOptions } from 'nodemailer';

import type { ConfigSmtp } from './ambiente';
import {
  type CodigoErroEnvioEmail,
  ErroEnvioEmail,
  type MensagemEmail,
  type PortaEmail,
  type ResultadoEnvioEmail,
  validarMensagemEmail,
} from './port';

// Adaptador real de e-mail transacional por SMTP (RN-9, D-007 §3.9). Host e porta vêm da config
// (RN-6: os testes apontam para um stub local). Nada é registrado em log (RN-7, RN-22): o logger e
// o debug do nodemailer ficam desligados e os erros do provedor são reconstruídos do zero.

/** Tempos-limite por fase (D-11). Ficam abaixo do encerramento gracioso do worker (R-11). */
export const TIMEOUTS_SMTP_MS = {
  conexao: 10_000,
  saudacao: 10_000,
  socket: 10_000,
  dns: 10_000,
} as const;

export type OpcoesEmailReal = ConfigSmtp & {
  /**
   * Força (ou dispensa) o STARTTLS. Padrão: exigido quando há autenticação sem TLS implícito,
   * para a senha nunca trafegar em texto claro. Só os testes com o stub passam `false`.
   */
  exigirTls?: boolean;
  timeouts?: Partial<Record<keyof typeof TIMEOUTS_SMTP_MS, number>>;
};

export type EmailReal = PortaEmail & {
  /** Fecha o transporte. Fora da porta: só para testes e encerramento. */
  fechar(): void;
};

/** Pura: as opções entregues ao `createTransport`. */
export function opcoesDoTransporte(o: OpcoesEmailReal): SMTPTransportOptions {
  const timeouts = { ...TIMEOUTS_SMTP_MS, ...o.timeouts };
  return {
    host: o.host,
    port: o.porta,
    secure: o.seguro,
    ...(o.autenticacao ? { auth: { user: o.autenticacao.usuario, pass: o.autenticacao.senha } } : {}),
    requireTLS: o.exigirTls ?? (!o.seguro && o.autenticacao !== null),
    connectionTimeout: timeouts.conexao,
    greetingTimeout: timeouts.saudacao,
    socketTimeout: timeouts.socket,
    dnsTimeout: timeouts.dns,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

const CODIGOS_CONEXAO = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED']);

/**
 * Pura: traduz o erro do nodemailer num ErroEnvioEmail NOVO, só com código e mensagem fixa.
 * Nada do erro original (`cause`, `response`, `command`, `message`) é copiado: o `command` e o
 * `response` podem carregar a credencial do AUTH (R-2, CA-12).
 */
export function traduzirErroSmtp(erro: unknown): ErroEnvioEmail {
  const e = (typeof erro === 'object' && erro !== null ? erro : {}) as {
    code?: unknown;
    command?: unknown;
    responseCode?: unknown;
    permanent?: unknown;
  };
  const comando = typeof e.command === 'string' ? e.command.toUpperCase() : '';
  const resposta = typeof e.responseCode === 'number' ? e.responseCode : 0;

  let codigo: CodigoErroEnvioEmail = 'outro';
  if (e.code === 'EAUTH') codigo = 'autenticacao';
  else if (
    e.code === 'EENVELOPE' ||
    (resposta >= 500 && resposta < 600 && /^(RCPT|MAIL)\b/.test(comando))
  ) {
    codigo = 'recusado';
  } else if (typeof e.code === 'string' && CODIGOS_CONEXAO.has(e.code)) codigo = 'conexao';

  return new ErroEnvioEmail(codigo, e.permanent !== true);
}

export function criarEmailReal(o: OpcoesEmailReal): EmailReal {
  const transporte = createTransport(opcoesDoTransporte(o));
  return {
    async enviar(m: MensagemEmail): Promise<ResultadoEnvioEmail> {
      validarMensagemEmail(m);
      let messageId: string;
      try {
        const info = await transporte.sendMail({
          from: o.remetente,
          to: m.para,
          subject: m.assunto,
          text: m.texto,
          ...(m.html !== undefined ? { html: m.html } : {}),
        });
        messageId = info.messageId;
      } catch (erro) {
        throw traduzirErroSmtp(erro);
      }
      return { provedorId: messageId };
    },
    fechar() {
      transporte.close();
    },
  };
}
