// Porta do WhatsApp (RN-11). Não importa provedor, Prisma nem process.env.

/** Modelos aprovados; iguais aos valores do enum `tipo_mensagem` do banco. */
export const MODELOS_WHATSAPP = ['confirmacao', 'remarcacao', 'cancelamento'] as const;
export type ModeloWhatsApp = (typeof MODELOS_WHATSAPP)[number];

export type EnvioModelo = {
  destinatarioE164: string;
  modelo: ModeloWhatsApp;
  /** Parâmetros nomeados; a E7.2 os mapeia para a ordem do template. */
  parametros: Readonly<Record<string, string>>;
  /** `reserva:tipo:revisao` (formato da E7.1); aqui só se exige que não seja vazia. */
  chaveIdempotencia: string;
};

export type ResultadoEnvioModelo = { provedorMensagemId: string };

export interface PortaWhatsApp {
  enviarModelo(e: EnvioModelo): Promise<ResultadoEnvioModelo>;
}

/** Falha que pode ser repetida com backoff. Mensagem fixa; o código identifica a causa. */
export class ErroEnvioTemporario extends Error {
  readonly codigo: string;

  constructor(codigo: string) {
    super('Falha temporária no envio da mensagem de WhatsApp.');
    this.name = 'ErroEnvioTemporario';
    this.codigo = codigo;
  }
}

/** Falha definitiva: repetir não adianta. Mensagem fixa; o código identifica a causa. */
export class ErroEnvioPermanente extends Error {
  readonly codigo: string;

  constructor(codigo: string) {
    super('Falha permanente no envio da mensagem de WhatsApp.');
    this.name = 'ErroEnvioPermanente';
    this.codigo = codigo;
  }
}

/** Mesmo padrão de `cliente_telefone_e164_chk` (D-004). A E5.1 pode movê-lo para o módulo de telefone. */
export const E164_BR = /^\+55[1-9][0-9]{9,10}$/;

/** Códigos de ErroEnvioPermanente gerados pela validação de entrada. */
export const CODIGOS_ENTRADA_INVALIDA = {
  destinatario: 'destinatario_invalido',
  modelo: 'modelo_invalido',
  chaveIdempotencia: 'chave_idempotencia_vazia',
} as const;

/**
 * Validação comum a simulado e real, feita antes do envio. Devolve o erro (o chamador
 * decide registrar a tentativa e lançá-lo) ou null quando a entrada é aceitável.
 */
export function validarEnvioModelo(e: EnvioModelo): ErroEnvioPermanente | null {
  if (typeof e.destinatarioE164 !== 'string' || !E164_BR.test(e.destinatarioE164)) {
    return new ErroEnvioPermanente(CODIGOS_ENTRADA_INVALIDA.destinatario);
  }
  if (!(MODELOS_WHATSAPP as readonly string[]).includes(e.modelo)) {
    return new ErroEnvioPermanente(CODIGOS_ENTRADA_INVALIDA.modelo);
  }
  if (typeof e.chaveIdempotencia !== 'string' || e.chaveIdempotencia.trim() === '') {
    return new ErroEnvioPermanente(CODIGOS_ENTRADA_INVALIDA.chaveIdempotencia);
  }
  return null;
}
