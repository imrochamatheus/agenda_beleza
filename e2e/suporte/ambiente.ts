// Ambiente compartilhado do E2E com banco (D-036). Funções puras, sem I/O: usadas pelo
// playwright.config.ts e pelo preparar-banco.ts, para que ambos enxerguem o MESMO banco e diretório.
import path from 'node:path';

/** Porta do servidor do E2E (`E2E_PORT`, padrão 3000; 1 a 65535). Lida a cada chamada, nunca fixada em módulo. */
export function portaE2E(env: NodeJS.ProcessEnv = process.env): number {
  const bruta = env.E2E_PORT;
  if (bruta === undefined || bruta === '') return 3000;
  const porta = Number(bruta);
  if (!/^\d{1,5}$/.test(bruta) || porta < 1 || porta > 65535) {
    throw new Error('E2E_PORT inválida: informe um inteiro de 1 a 65535.');
  }
  return porta;
}

/** Origem do servidor do E2E (também o `APP_URL` dele). */
export function origemE2E(env: NodeJS.ProcessEnv = process.env): string {
  return `http://127.0.0.1:${portaE2E(env)}`;
}
// Constante pública, só do E2E (nunca um segredo real); 32+ caracteres exigidos pelo schema.
export const SEGREDO_E2E = 'e2e-segredo-publico-nao-e-segredo-0123456789';

// Chave TOTP de 32 bytes em base64, pública e só do E2E (exigida pelo schema de ambiente com NODE_ENV=production).
export const CHAVE_TOTP_E2E = 'Y29tcG9zZS1sb2NhbC1jaGF2ZS10b3RwLTAxMjM0NTY=';

export function urlDoBancoE2E(env: NodeJS.ProcessEnv): string {
  const direta = env.E2E_DATABASE_URL;
  if (direta) return direta;
  const base = env.TEST_DATABASE_URL;
  if (!base) throw new Error('Defina TEST_DATABASE_URL (ou E2E_DATABASE_URL) para o E2E com banco.');
  const url = new URL(base);
  const nome = `${url.pathname.replace(/^\//, '')}_e2e`;
  if (nome.length > 63) throw new Error('O nome da base do E2E passa de 63 caracteres.');
  url.pathname = `/${nome}`;
  return url.toString();
}

export function diretorioArmazenamentoE2E(raiz: string = process.cwd()): string {
  return path.resolve(raiz, '.armazenamento-e2e');
}

export function ambienteDoServidorE2E(env: NodeJS.ProcessEnv, raiz?: string): Record<string, string> {
  return {
    DATABASE_URL: urlDoBancoE2E(env),
    EMAIL_ADAPTER: 'simulado',
    WHATSAPP_ADAPTER: 'simulado',
    MP_ADAPTER: 'simulado',
    TURNSTILE_ADAPTER: 'simulado',
    STORAGE_ADAPTER: 'simulado',
    ARMAZENAMENTO_DIR: diretorioArmazenamentoE2E(raiz),
    PROTECAO_LIMITE_IP_RESERVA: '100000',
    PROTECAO_LIMITE_IP_DISPONIBILIDADE: '100000',
    PROTECAO_LIMITE_IP_AVALIACAO: '100000',
    PROTECAO_LIMITE_IP_DENUNCIA: '100000',
    PROTECAO_LIMITE_NUMERO: '100000',
    RATE_LIMIT_SEGREDO: SEGREDO_E2E,
    AVALIACAO_SEGREDO: SEGREDO_E2E,
    ADMIN_TOTP_CHAVE: CHAVE_TOTP_E2E,
    APP_URL: origemE2E(env),
    PORT: String(portaE2E(env)),
    VITRINE_COMPONENTES: 'true',
  };
}
