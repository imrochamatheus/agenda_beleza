import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import { describe, expect, it } from 'vitest';

import { CHAVES_FORA_DO_RUNTIME, chavesDeclaradas, ErroDeAmbiente, validarEnv } from './env';

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

  it('usa uma base de teste diferente da de desenvolvimento (RN-5)', () => {
    expect(new URL(exemplo.TEST_DATABASE_URL).pathname).not.toBe(
      new URL(exemplo.DATABASE_URL).pathname,
    );
  });
});

describe('validarEnv (CA-6)', () => {
  it('aceita o .env.example sem alterações e seleciona os adaptadores simulados (RN-1)', () => {
    expect(validarEnv(exemplo)).toEqual({
      DATABASE_URL: exemplo.DATABASE_URL,
      APP_URL: 'http://localhost:3000',
      EMAIL_ADAPTER: 'simulado',
      WHATSAPP_ADAPTER: 'simulado',
      MP_ADAPTER: 'simulado',
      TURNSTILE_ADAPTER: 'simulado',
    });
  });

  it('aplica os padrões quando só DATABASE_URL existe', () => {
    const env = validarEnv({ DATABASE_URL: URL_VALIDA });
    expect(env.APP_URL).toBe('http://localhost:3000');
    expect(env.MP_ADAPTER).toBe('simulado');
  });

  it('aceita o prefixo postgres:// e o adaptador real', () => {
    const env = validarEnv({ DATABASE_URL: 'postgres://a:b@h:5432/d', EMAIL_ADAPTER: 'real' });
    expect(env.EMAIL_ADAPTER).toBe('real');
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
});
