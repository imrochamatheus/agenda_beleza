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
  vitrineHabilitada,
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
  armazenamento: { modo: 'simulado' },
};

const FILA_PADRAO = { retryLimit: 4, retryDelaySeconds: 30, retryBackoff: true };

describe('validarEnv', () => {
  it('CA-1: aceita o .env.example sem alterações e seleciona os cinco adaptadores simulados', () => {
    expect(validarEnv(exemplo)).toEqual({
      DATABASE_URL: exemplo.DATABASE_URL,
      APP_URL: 'http://localhost:3000',
      fila: FILA_PADRAO,
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

  it('CA-5 (D-021): STORAGE_ADAPTER=real sem nenhuma S3_* nomeia as cinco, ordenadas e sem valores', () => {
    expect(falhaDe({ DATABASE_URL: URL_VALIDA, STORAGE_ADAPTER: 'real' }).variaveis).toEqual([
      'S3_ACCESS_KEY_ID',
      'S3_BUCKET',
      'S3_ENDPOINT',
      'S3_REGIAO',
      'S3_SECRET_ACCESS_KEY',
    ]);
    expect(
      falhaDe({
        DATABASE_URL: URL_VALIDA,
        STORAGE_ADAPTER: 'real',
        S3_ENDPOINT: 'ftp://x',
        S3_REGIAO: 'r',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
        S3_URL_PUBLICA: 'nao-e-url',
      }).variaveis,
    ).toEqual(['S3_ENDPOINT', 'S3_URL_PUBLICA']);
    expect(falhaDe({ DATABASE_URL: URL_VALIDA, STORAGE_ADAPTER: 'REAL' }).variaveis).toEqual(['STORAGE_ADAPTER']);
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

describe('CA-11 (D-008): variáveis da fila', () => {
  it('sem as três variáveis, ou com elas vazias, aplica os padrões 4, 30 e true', () => {
    expect(validarEnv({ DATABASE_URL: URL_VALIDA }).fila).toEqual(FILA_PADRAO);
    expect(
      validarEnv({
        DATABASE_URL: URL_VALIDA,
        QUEUE_RETRY_LIMIT: '',
        QUEUE_RETRY_DELAY_SECONDS: '',
        QUEUE_RETRY_BACKOFF: '',
      }).fila,
    ).toEqual(FILA_PADRAO);
  });

  it('converte valores válidos, inclusive os extremos das faixas', () => {
    expect(
      validarEnv({
        DATABASE_URL: URL_VALIDA,
        QUEUE_RETRY_LIMIT: '0',
        QUEUE_RETRY_DELAY_SECONDS: '3600',
        QUEUE_RETRY_BACKOFF: 'false',
      }).fila,
    ).toEqual({ retryLimit: 0, retryDelaySeconds: 3600, retryBackoff: false });
    expect(
      validarEnv({
        DATABASE_URL: URL_VALIDA,
        QUEUE_RETRY_LIMIT: '20',
        QUEUE_RETRY_DELAY_SECONDS: '1',
        QUEUE_RETRY_BACKOFF: 'true',
      }).fila,
    ).toEqual({ retryLimit: 20, retryDelaySeconds: 1, retryBackoff: true });
  });

  it.each([
    ['QUEUE_RETRY_LIMIT', '-1'],
    ['QUEUE_RETRY_LIMIT', '21'],
    ['QUEUE_RETRY_LIMIT', 'abc'],
    ['QUEUE_RETRY_LIMIT', ' 4'],
    ['QUEUE_RETRY_LIMIT', '1.5'],
    ['QUEUE_RETRY_DELAY_SECONDS', '0'],
    ['QUEUE_RETRY_DELAY_SECONDS', '1.5'],
    ['QUEUE_RETRY_DELAY_SECONDS', '3601'],
    ['QUEUE_RETRY_BACKOFF', 'sim'],
    ['QUEUE_RETRY_BACKOFF', 'TRUE'],
  ])('%s=%j é recusado nomeando só a variável, sem o valor', (variavel, valor) => {
    const erro = falhaDe({ DATABASE_URL: URL_VALIDA, [variavel]: valor });
    expect(erro).toBeInstanceOf(ErroDeAmbiente);
    expect(erro.variaveis).toEqual([variavel]);
    expect(erro.message).toBe(`Variáveis de ambiente ausentes ou inválidas: ${variavel}`);
  });

  it('o .env.example traz as três chaves com os padrões e um comentário de unidade e padrão', () => {
    const texto = readFileSync(caminhoExemplo, 'utf8');
    expect(exemplo).toMatchObject({
      QUEUE_RETRY_LIMIT: '4',
      QUEUE_RETRY_DELAY_SECONDS: '30',
      QUEUE_RETRY_BACKOFF: 'true',
    });
    const comentarioAntes = (chave: string) => {
      const linhas = texto.split('\n');
      const i = linhas.findIndex((l) => l.startsWith(`${chave}=`));
      const bloco: string[] = [];
      for (let j = i - 1; j >= 0 && linhas[j].startsWith('#'); j--) bloco.unshift(linhas[j]);
      return bloco.join(' ');
    };
    expect(comentarioAntes('QUEUE_RETRY_LIMIT')).toMatch(/Padrão: 4.*5 execuções/);
    expect(comentarioAntes('QUEUE_RETRY_DELAY_SECONDS')).toMatch(/segundos.*Padrão: 30/);
    expect(comentarioAntes('QUEUE_RETRY_BACKOFF')).toMatch(/true \| false.*Padrão: true/);
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
      armazenamento: 'simulado',
      email: 'simulado',
      mercadoPago: 'simulado',
      turnstile: 'real',
      whatsapp: 'simulado',
    });
    expect(Object.keys(modos)).toEqual(['armazenamento', 'email', 'mercadoPago', 'turnstile', 'whatsapp']);
    expect(JSON.stringify(modos)).not.toContain('segredo-turnstile');
  });
});

describe('D-009 (CA-18): VITRINE_COMPONENTES e vitrineHabilitada', () => {
  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['false', 'false'],
    ['1', '1'],
    ['TRUE', 'TRUE'],
    ['sim', 'sim'],
    [' true', ' true'],
  ])('production com a variável %s → desabilitada', (_rotulo, valor) => {
    expect(vitrineHabilitada({ NODE_ENV: 'production', VITRINE_COMPONENTES: valor })).toBe(false);
  });

  it('só o texto exato "true" habilita, em qualquer NODE_ENV', () => {
    for (const NODE_ENV of ['production', 'test', undefined]) {
      expect(vitrineHabilitada({ NODE_ENV, VITRINE_COMPONENTES: 'true' })).toBe(true);
    }
  });

  it('NODE_ENV=development habilita sem a variável; test sem a variável não', () => {
    expect(vitrineHabilitada({ NODE_ENV: 'development' })).toBe(true);
    expect(vitrineHabilitada({ NODE_ENV: 'test' })).toBe(false);
    expect(vitrineHabilitada({})).toBe(false);
  });

  it('não valida o resto do ambiente (sem DATABASE_URL, com seletor inválido)', () => {
    expect(vitrineHabilitada({ VITRINE_COMPONENTES: 'true', MP_ADAPTER: 'x' })).toBe(true);
  });

  it('validarEnv aceita true/false/ausente e não acrescenta campo ao Env', () => {
    for (const valor of ['true', 'false', undefined, '']) {
      const env = validarEnv({ DATABASE_URL: URL_VALIDA, VITRINE_COMPONENTES: valor });
      expect(Object.keys(env).sort()).toEqual(['APP_URL', 'DATABASE_URL', 'fila', 'integracoes']);
    }
  });

  it.each(['TRUE', '1', 'sim', 'yes'])('validarEnv recusa %s nomeando só a variável', (valor) => {
    const erro = falhaDe({ DATABASE_URL: URL_VALIDA, VITRINE_COMPONENTES: valor });
    expect(erro).toBeInstanceOf(ErroDeAmbiente);
    expect(erro.variaveis).toEqual(['VITRINE_COMPONENTES']);
    expect(erro.message).toBe('Variáveis de ambiente ausentes ou inválidas: VITRINE_COMPONENTES');
  });

  it('o .env.example traz VITRINE_COMPONENTES=false com comentário', () => {
    expect(exemplo.VITRINE_COMPONENTES).toBe('false');
    const texto = readFileSync(caminhoExemplo, 'utf8');
    expect(texto).toMatch(/# Vitrine \/dev\/componentes \(true \| false; padrão false\)[^\n]*\n[^\n]*nunca true em produção/);
  });
});


describe('proteção da página pública (D-027)', () => {
  const base = { DATABASE_URL: URL_VALIDA };

  it('CA-15: TRUSTED_PROXY_HOPS inválido falha nomeando a variável', () => {
    for (const v of ['-1', '11', 'abc', '1.5', '1e1']) {
      expect(falhaDe({ ...base, TRUSTED_PROXY_HOPS: v }).variaveis).toEqual(['TRUSTED_PROXY_HOPS']);
    }
    expect(() => validarEnv({ ...base, TRUSTED_PROXY_HOPS: '10' })).not.toThrow();
  });

  it('limites e janela inválidos são nomeados', () => {
    expect(falhaDe({ ...base, PROTECAO_LIMITE_NUMERO: '0', PROTECAO_JANELA_SEGUNDOS: '10' }).variaveis).toEqual([
      'PROTECAO_JANELA_SEGUNDOS',
      'PROTECAO_LIMITE_NUMERO',
    ]);
  });

  it('RATE_LIMIT_SEGREDO: obrigatório (≥ 32) só em produção; curto é recusado sempre', () => {
    expect(() => validarEnv(base)).not.toThrow();
    expect(falhaDe({ ...base, NODE_ENV: 'production', AVALIACAO_SEGREDO: 'y'.repeat(32) }).variaveis).toEqual(['RATE_LIMIT_SEGREDO']);
    expect(() => validarEnv({ ...base, NODE_ENV: 'production', RATE_LIMIT_SEGREDO: 'x'.repeat(32), AVALIACAO_SEGREDO: 'y'.repeat(32) })).not.toThrow();
    expect(falhaDe({ ...base, RATE_LIMIT_SEGREDO: 'curto' }).variaveis).toEqual(['RATE_LIMIT_SEGREDO']);
  });

  it('AVALIACAO_SEGREDO: obrigatório (≥ 32) só em produção; curto é recusado sempre', () => {
    const prod = { ...base, NODE_ENV: 'production', RATE_LIMIT_SEGREDO: 'x'.repeat(32) };
    expect(() => validarEnv(base)).not.toThrow();
    expect(falhaDe(prod).variaveis).toEqual(['AVALIACAO_SEGREDO']);
    expect(() => validarEnv({ ...prod, AVALIACAO_SEGREDO: 'y'.repeat(32) })).not.toThrow();
    expect(falhaDe({ ...base, AVALIACAO_SEGREDO: 'curto' }).variaveis).toEqual(['AVALIACAO_SEGREDO']);
    expect(exemplo.AVALIACAO_SEGREDO).toBe('');
  });

  it('o .env.example traz os padrões e o segredo vazio', () => {
    expect(exemplo.TRUSTED_PROXY_HOPS).toBe('0');
    expect(exemplo.RATE_LIMIT_SEGREDO).toBe('');
    expect(exemplo.PROTECAO_JANELA_SEGUNDOS).toBe('900');
    expect(exemplo.PROTECAO_LIMITE_IP_RESERVA).toBe('10');
  });
});
