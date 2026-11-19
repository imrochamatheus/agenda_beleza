import { describe, expect, it } from 'vitest';

import { destinoAposLogin } from './destino';

// CA-8 (RN-15): destino após o login sem redirecionamento aberto.
describe('CA-8: destinoAposLogin', () => {
  it.each([
    ['/painel', '/painel'],
    ['/painel/agenda?dia=2026-12-01', '/painel/agenda?dia=2026-12-01'],
    ['/painel/', '/painel/'],
    ['/painel/agenda#x', '/painel/agenda'],
    ['/painel?x=1', '/painel?x=1'],
  ])('CA-8: aceita %j → %j', (entrada, esperado) => {
    expect(destinoAposLogin(entrada)).toBe(esperado);
  });

  it.each([
    undefined,
    null,
    42,
    ['/painel'],
    '',
    '/',
    '/admin',
    '/painelx',
    '//evil.com',
    '/\\evil.com',
    'https://evil.com/painel',
    '/painel/../admin',
    '/painel/%2e%2e/admin',
    '/painel/%2E%2E/admin',
    '%2F%2Fevil.com',
    'javascript:alert(1)',
    '/painel/\nx',
    '/painel/\tx',
    '/painel/\u007f',
    `/painel/${'a'.repeat(2049 - '/painel/'.length)}`,
  ])('CA-8: recusa %j → /painel', (entrada) => {
    expect(destinoAposLogin(entrada)).toBe('/painel');
  });

  it('CA-8: 2048 caracteres ainda é aceito', () => {
    const longo = `/painel/${'a'.repeat(2048 - '/painel/'.length)}`;
    expect(longo).toHaveLength(2048);
    expect(destinoAposLogin(longo)).toBe(longo);
  });
});
