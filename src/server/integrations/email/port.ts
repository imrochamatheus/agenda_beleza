import { z } from 'zod';

// Porta de e-mail transacional (RN-9). Não importa provedor, Prisma nem process.env.

export type MensagemEmail = {
  /** Um único endereço de destino. */
  para: string;
  assunto: string;
  /** Corpo em texto puro; é o que o simulado grava em `email_log.corpo` (D-8). */
  texto: string;
  /** Opcional; só o adaptador real o envia (D-8). */
  html?: string;
};

/** Simulado: id da linha de `email_log`; real: `messageId` do SMTP. */
export type ResultadoEnvioEmail = { provedorId: string };

export interface PortaEmail {
  enviar(m: MensagemEmail): Promise<ResultadoEnvioEmail>;
}

export type CampoMensagemEmail = 'para' | 'assunto' | 'texto';

const MENSAGENS_VALIDACAO: Record<CampoMensagemEmail, string> = {
  para: 'E-mail inválido: o destinatário deve ser um único endereço válido.',
  assunto: 'E-mail inválido: o assunto é obrigatório e não pode ter quebra de linha.',
  texto: 'E-mail inválido: o texto é obrigatório.',
};

/** Entrada inválida (RN-9). A mensagem é fixa por campo e nunca ecoa o valor recebido. */
export class ErroValidacaoEmail extends Error {
  readonly campo: CampoMensagemEmail;

  constructor(campo: CampoMensagemEmail) {
    super(MENSAGENS_VALIDACAO[campo]);
    this.name = 'ErroValidacaoEmail';
    this.campo = campo;
  }
}

export type CodigoErroEnvioEmail = 'conexao' | 'autenticacao' | 'recusado' | 'outro';

const MENSAGENS_ENVIO: Record<CodigoErroEnvioEmail, string> = {
  conexao: 'Falha no envio do e-mail: servidor de e-mail inacessível.',
  autenticacao: 'Falha no envio do e-mail: autenticação recusada pelo servidor de e-mail.',
  recusado: 'Falha no envio do e-mail: mensagem recusada pelo servidor de e-mail.',
  outro: 'Falha no envio do e-mail.',
};

/**
 * Falha do provedor de e-mail (RN-9, RN-7). Mensagem fixa por código e SEM `cause`:
 * o erro do provedor pode conter credenciais e nunca é repassado.
 */
export class ErroEnvioEmail extends Error {
  readonly codigo: CodigoErroEnvioEmail;
  readonly temporario: boolean;

  constructor(codigo: CodigoErroEnvioEmail, temporario: boolean) {
    super(MENSAGENS_ENVIO[codigo]);
    this.name = 'ErroEnvioEmail';
    this.codigo = codigo;
    this.temporario = temporario;
  }
}

const EMAIL = z.email();
const SEPARADORES_OU_QUEBRAS = /[,;<>\r\n]/;
const QUEBRAS = /[\r\n]/;

/**
 * RN-9: lança ErroValidacaoEmail. Chamada por simulado e real ANTES de qualquer efeito.
 * Valida na ordem `para`, `assunto`, `texto` e para no primeiro campo inválido.
 */
export function validarMensagemEmail(m: MensagemEmail): void {
  if (
    typeof m.para !== 'string' ||
    SEPARADORES_OU_QUEBRAS.test(m.para) ||
    !EMAIL.safeParse(m.para).success
  ) {
    throw new ErroValidacaoEmail('para');
  }
  if (typeof m.assunto !== 'string' || m.assunto.trim() === '' || QUEBRAS.test(m.assunto)) {
    throw new ErroValidacaoEmail('assunto');
  }
  if (typeof m.texto !== 'string' || m.texto.trim() === '') {
    throw new ErroValidacaoEmail('texto');
  }
}
