import { z } from 'zod';

// Exigências de ambiente do e-mail real (RN-13, D-10 com ajuste). Só importa zod: este módulo
// entra no bundle do check-env, que não pode puxar nodemailer nem o Prisma.

export const SELETOR = 'EMAIL_ADAPTER';

/** Variáveis do provedor, declaradas no .env.example. Ignoradas no modo simulado. */
export const CHAVES = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_SECURE',
  'EMAIL_FROM',
] as const;

export type ConfigSmtp = {
  host: string;
  porta: number;
  /** TLS implícito (SMTPS). Com `false`, a conexão pode subir para TLS via STARTTLS. */
  seguro: boolean;
  autenticacao: { usuario: string; senha: string } | null;
  /** `email` ou `Nome <email>`, como informado em EMAIL_FROM. */
  remetente: string;
};
export type ConfigReal = ConfigSmtp;

/** Porta padrão: 465 (TLS implícito) com SMTP_SECURE=true; 587 (submissão) nos demais casos. */
export const PORTA_PADRAO_SEGURA = 465;
export const PORTA_PADRAO = 587;

const EMAIL = z.email();
const NOME_E_EMAIL = /^([^<>]*)<([^<>]+)>$/;

/** `email` ou `Nome <email>`, sem CR nem LF; o e-mail interno passa por `z.email()`. */
function remetenteValido(valor: string): boolean {
  if (/[\r\n]/.test(valor)) return false;
  const comNome = NOME_E_EMAIL.exec(valor.trim());
  const email = comNome ? comNome[2].trim() : valor.trim();
  return EMAIL.safeParse(email).success;
}

/**
 * Lê a configuração do modo real. `fonte` já vem com string vazia convertida em ausente.
 * Devolve todas as variáveis inválidas, nunca os valores.
 */
export function lerConfigReal(
  fonte: Record<string, string | undefined>,
): { ok: true; config: ConfigSmtp } | { ok: false; variaveis: string[] } {
  const variaveis: string[] = [];
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_SECURE, EMAIL_FROM } = fonte;

  if (SMTP_HOST === undefined) variaveis.push('SMTP_HOST');
  if (EMAIL_FROM === undefined || !remetenteValido(EMAIL_FROM)) variaveis.push('EMAIL_FROM');

  let seguro = false;
  if (SMTP_SECURE === 'true') seguro = true;
  else if (SMTP_SECURE !== undefined && SMTP_SECURE !== 'false') variaveis.push('SMTP_SECURE');

  let porta = seguro ? PORTA_PADRAO_SEGURA : PORTA_PADRAO;
  if (SMTP_PORT !== undefined) {
    const numero = /^[0-9]+$/.test(SMTP_PORT) ? Number(SMTP_PORT) : NaN;
    if (Number.isInteger(numero) && numero >= 1 && numero <= 65535) porta = numero;
    else variaveis.push('SMTP_PORT');
  }

  if (SMTP_USER !== undefined && SMTP_PASSWORD === undefined) variaveis.push('SMTP_PASSWORD');
  if (SMTP_PASSWORD !== undefined && SMTP_USER === undefined) variaveis.push('SMTP_USER');

  if (variaveis.length > 0) return { ok: false, variaveis: variaveis.sort() };
  return {
    ok: true,
    config: {
      host: SMTP_HOST!,
      porta,
      seguro,
      autenticacao:
        SMTP_USER !== undefined ? { usuario: SMTP_USER, senha: SMTP_PASSWORD! } : null,
      remetente: EMAIL_FROM!.trim(),
    },
  };
}
