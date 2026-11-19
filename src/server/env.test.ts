import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  CHAVES_FORA_DO_RUNTIME,
  chavesDeclaradas,
  ErroDeAmbiente,
  modoSelecionado,
  modosAtivos,
  validarEnv,
} from './env';

const caminhoExemplo = fileURLToPath(new URL('../../.env.example', import.meta.url));
const exemplo = parseEnv(readFileSync(caminhoExemplo, 'utf8')) as Record<string, string>;

const URL_VALIDA = 'postgresql://agenda:segredo123@localhost:5432/agenda_beleza';

function falhaDe(fonte: Record<string, string | undefined>): ErroDeAmbiente {
  try {
    validarEnv(fonte);
  } catch (erro) {
    return erro as ErroDeAmbiente;
  }
  throw new Error('validarEnv deveria ter falhado');
}

describe('chaves do .env.example x env.ts (CA-3)', () => {
  it('coincidem nos dois lados', () => {
    const noExemplo = Object.keys(exemplo).sort();
    const declaradas = chavesDeclaradas().sort();
    const sobrandoNoExemplo = noExemplo.filter((c) => !declaradas.includes(c));
    const faltandoNoExemplo = declaradas.filter((c) => !noExemplo.includes(c));
    expect(
      { sobrandoNoExemplo, faltandoNoExemplo },
      'chaves sobrando no .env.example (declare em env.ts) / faltando no .env.example',
    ).toEqual({ sobrandoNoExemplo: [], faltandoNoExemplo: [] });
  });

  it('declara as chaves de infraestrutura fora do schema do runtime (S-3)', () => {
    expect(chavesDeclaradas()).toEqual(expect.arrayContaining([...CHAVES_FORA_DO_RUNTIME]));
    expect(new Set(chavesDeclaradas()).size).toBe(chavesDeclaradas().length);
  });

  it('CA-25: declara as variáveis da RN-8, com as credenciais vazias e os seletores em simulado', () => {
    const rn8 = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASSWORD',
      'SMTP_SECURE',
      'EMAIL_FROM',
      'TURNSTILE_SITE_KEY',
      'TURNSTILE_SECRET_KEY',
    ];
    expect(chavesDeclaradas()).toEqual(expect.arrayContaining(rn8));
    for (const chave of rn8) expect(exemplo[chave], chave).toBe('');
    for (const seletor of ['EMAIL_ADAPTER', 'WHATSAPP_ADAPTER', 'MP_ADAPTER', 'TURNSTILE_ADAPTER']) {
      expect(exemplo[seletor], seletor).toBe('simulado');
    }
  });

  it('usa uma base de teste diferente da de desenvolvimento (RN-5)', () => {
    expect(new URL(exemplo.TEST_DATABASE_URL).pathname).not.toBe(
      new URL(exemplo.DATABASE_URL).pathname,
    );
  });
});

const SIMULADOS = {
  email: { modo: 'simulado' },
  turnstile: { modo: 'simulado' },
  mercadoPago: { modo: 'simulado' },
  whatsapp: { modo: 'simulado' },
};

describe('validarEnv', () => {
  it('CA-1: aceita o .env.example sem alterações e seleciona os quatro adaptadores simulados', () => {
    expect(validarEnv(exemplo)).toEqual({
      DATABASE_URL: exemplo.DATABASE_URL,
      APP_URL: 'http://localhost:3000',
      integracoes: SIMULADOS,
    });
  });

  it('aplica os padrões quando só DATABASE_URL existe', () => {
    const env = validarEnv({ DATABASE_URL: URL_VALIDA });
    expect(env.APP_URL).toBe('http://localhost:3000');
    expect(env.integracoes).toEqual(SIMULADOS);
  });

  it('aceita o prefixo postgres://', () => {
    expect(validarEnv({ DATABASE_URL: 'postgres://a:b@h:5432/d' }).DATABASE_URL).toBe(
      'postgres://a:b@h:5432/d',
    );
  });

  it('falha sem DATABASE_URL e nomeia a variável', () => {
    const erro = falhaDe({});
    expect(erro).toBeInstanceOf(ErroDeAmbiente);
    expect(erro.variaveis).toEqual(['DATABASE_URL']);
    expect(erro.message).toContain('DATABASE_URL');
  });

  it('trata string vazia como ausente: DATABASE_URL= falha e APP_URL= cai no padrão', () => {
    expect(falhaDe({ DATABASE_URL: '' }).variaveis).toEqual(['DATABASE_URL']);
    expect(validarEnv({ DATABASE_URL: URL_VALIDA, APP_URL: '' }).APP_URL).toBe(
      'http://localhost:3000',
    );
  });

  it('falha com APP_URL que não é URL e nomeia a variável', () => {
    const erro = falhaDe({ DATABASE_URL: URL_VALIDA, APP_URL: 'nao-url' });
    expect(erro.variaveis).toEqual(['APP_URL']);
    expect(erro.message).toContain('APP_URL');
  });

  it('rejeita protocolos errados e adaptador desconhecido, listando os nomes ordenados', () => {
    const erro = falhaDe({
      DATABASE_URL: 'mysql://a:b@h/d',
      APP_URL: 'ftp://exemplo.com',
      WHATSAPP_ADAPTER: 'falso',
    });
    expect(erro.variaveis).toEqual(['APP_URL', 'DATABASE_URL', 'WHATSAPP_ADAPTER']);
  });

  it('nunca inclui o valor da variável na mensagem', () => {
    const erro = falhaDe({ DATABASE_URL: 'senha-super-secreta' });
    expect(erro.message).not.toContain('senha-super-secreta');
  });

  it('com e-mail real completo devolve a config SMTP com os padrões (587, sem TLS implícito)', () => {
    const env = validarEnv({
      DATABASE_URL: URL_VALIDA,
      EMAIL_ADAPTER: 'real',
      SMTP_HOST: 'smtp.exemplo.com',
      EMAIL_FROM: 'Agenda Beleza <nao-responda@exemplo.com>',
      SMTP_PORT: '',
      SMTP_SECURE: '',
    });
    expect(env.integracoes.email).toEqual({
      modo: 'real',
      config: {
        host: 'smtp.exemplo.com',
        porta: 587,
        seguro: false,
        autenticacao: null,
        remetente: 'Agenda Beleza <nao-responda@exemplo.com>',
      },
    });
    expect(env.integracoes.turnstile).toEqual({ modo: 'simulado' });
  });

  it('com Turnstile real completo devolve só o segredo na config (a chave do site é lida por chamada)', () => {
    const env = validarEnv({
      DATABASE_URL: URL_VALIDA,
      TURNSTILE_ADAPTER: 'real',
      TURNSTILE_SITE_KEY: 'chave-publica',
      TURNSTILE_SECRET_KEY: 'segredo',
    });
    expect(env.integracoes.turnstile).toEqual({ modo: 'real', config: { segredo: 'segredo' } });
  });

  it('CA-2: EMAIL_ADAPTER=real sem SMTP_HOST nomeia SMTP_HOST', () => {
    const erro = falhaDe({
      DATABASE_URL: URL_VALIDA,
      EMAIL_ADAPTER: 'real',
      EMAIL_FROM: 'a@exemplo.com',
    });
    expect(erro.variaveis).toEqual(['SMTP_HOST']);
  });

  it.each([
    ['MP_ADAPTER', 'MP_ADAPTER'],
    ['WHATSAPP_ADAPTER', 'WHATSAPP_ADAPTER'],
  ])('CA-9: %s=real é recusado nomeando o seletor (D-1)', (seletor, nome) => {
    expect(falhaDe({ DATABASE_URL: URL_VALIDA, [seletor]: 'real' }).variaveis).toEqual([nome]);
  });

  it('RN-13: lista num único erro, ordenadas, as variáveis da base e de todas as integrações em real', () => {
    const erro = falhaDe({
      DATABASE_URL: '',
      EMAIL_ADAPTER: 'real',
      SMTP_USER: 'usuario',
      TURNSTILE_ADAPTER: 'real',
      MP_ADAPTER: 'real',
      WHATSAPP_ADAPTER: 'real',
    });
    expect(erro.variaveis).toEqual([
      'DATABASE_URL',
      'EMAIL_FROM',
      'MP_ADAPTER',
      'SMTP_HOST',
      'SMTP_PASSWORD',
      'TURNSTILE_SECRET_KEY',
      'TURNSTILE_SITE_KEY',
      'WHATSAPP_ADAPTER',
    ]);
    expect(erro.message).not.toContain('usuario');
  });

  it('CA-8: no modo simulado as variáveis do provedor são ignoradas (nem obrigatórias nem validadas)', () => {
    const env = validarEnv({
      DATABASE_URL: URL_VALIDA,
      SMTP_PORT: 'abc',
      SMTP_SECURE: 'talvez',
      SMTP_USER: 'só-usuario',
      EMAIL_FROM: 'nao-email',
      TURNSTILE_SITE_KEY: '',
      TURNSTILE_SECRET_KEY: '',
    });
    expect(env.integracoes).toEqual(SIMULADOS);
  });

  it('com seletor inválido nomeia só o seletor, sem ler as variáveis do provedor', () => {
    expect(falhaDe({ DATABASE_URL: URL_VALIDA, EMAIL_ADAPTER: 'Real' }).variaveis).toEqual([
      'EMAIL_ADAPTER',
    ]);
  });

  it('não altera a fonte recebida', () => {
    const fonte = { DATABASE_URL: URL_VALIDA, APP_URL: '' };
    validarEnv(fonte);
    expect(fonte).toEqual({ DATABASE_URL: URL_VALIDA, APP_URL: '' });
  });
});

describe('ErroDeAmbiente', () => {
  it('ordena e remove nomes repetidos', () => {
    const erro = new ErroDeAmbiente(['SMTP_PORT', 'APP_URL', 'SMTP_PORT']);
    expect(erro.variaveis).toEqual(['APP_URL', 'SMTP_PORT']);
    expect(erro.message).toBe('Variáveis de ambiente ausentes ou inválidas: APP_URL, SMTP_PORT');
    expect(erro.name).toBe('ErroDeAmbiente');
  });
});

describe('modoSelecionado', () => {
  it.each([
    [undefined, 'simulado'],
    ['', 'simulado'],
    ['simulado', 'simulado'],
    ['real', 'real'],
    ['REAL', null],
    ['falso', null],
  ])('%j → %j', (valor, esperado) => {
    expect(modoSelecionado({ MP_ADAPTER: valor }, 'MP_ADAPTER')).toBe(esperado);
  });

  it('não valida o resto do ambiente', () => {
    expect(modoSelecionado({ EMAIL_ADAPTER: 'real' }, 'EMAIL_ADAPTER')).toBe('real');
    expect(modoSelecionado({}, 'TURNSTILE_ADAPTER')).toBe('simulado');
  });
});

describe('modosAtivos', () => {
  it('CA-1: devolve só os modos, em ordem alfabética, sem nenhum valor de configuração', () => {
    const env = validarEnv({
      DATABASE_URL: URL_VALIDA,
      TURNSTILE_ADAPTER: 'real',
      TURNSTILE_SITE_KEY: 'chave-publica',
      TURNSTILE_SECRET_KEY: 'segredo-turnstile',
    });
    const modos = modosAtivos(env);
    expect(modos).toEqual({
      email: 'simulado',
      mercadoPago: 'simulado',
      turnstile: 'real',
      whatsapp: 'simulado',
    });
    expect(Object.keys(modos)).toEqual(['email', 'mercadoPago', 'turnstile', 'whatsapp']);
    expect(JSON.stringify(modos)).not.toContain('segredo-turnstile');
  });
});
