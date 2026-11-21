import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHAVES, DIRETORIO_PADRAO, lerConfigReal, SELETOR } from './ambiente';

const BASE = {
  S3_ENDPOINT: 'https://s3.exemplo.test',
  S3_REGIAO: 'auto',
  S3_BUCKET: 'fotos',
  S3_ACCESS_KEY_ID: 'AKIA-X',
  S3_SECRET_ACCESS_KEY: 'segredo-xyz',
};

describe('armazenamento/ambiente (RN-19)', () => {
  it('declara seletor, chaves e diretório padrão; não importa nada', () => {
    expect(SELETOR).toBe('STORAGE_ADAPTER');
    expect(CHAVES).toContain('ARMAZENAMENTO_DIR');
    expect(CHAVES).toContain('S3_FORCE_PATH_STYLE');
    expect(DIRETORIO_PADRAO).toBe('.armazenamento');
    const fonte = readFileSync(fileURLToPath(new URL('./ambiente.ts', import.meta.url)), 'utf8');
    expect(fonte).not.toMatch(/^import /m);
  });

  it('config completa: padrão path-style true e sem URL pública', () => {
    expect(lerConfigReal(BASE)).toEqual({
      ok: true,
      config: { endpoint: BASE.S3_ENDPOINT, regiao: 'auto', bucket: 'fotos', accessKeyId: 'AKIA-X', secretAccessKey: 'segredo-xyz', urlPublica: null, pathStyle: true },
    });
  });

  it('S3_URL_PUBLICA sem barra final; http só em localhost; S3_FORCE_PATH_STYLE=false', () => {
    const r = lerConfigReal({ ...BASE, S3_URL_PUBLICA: 'https://cdn.exemplo.test/', S3_FORCE_PATH_STYLE: 'false' });
    expect(r).toMatchObject({ ok: true, config: { urlPublica: 'https://cdn.exemplo.test', pathStyle: false } });
    expect(lerConfigReal({ ...BASE, S3_URL_PUBLICA: 'http://localhost:9000/b' })).toMatchObject({ ok: true });
    expect(lerConfigReal({ ...BASE, S3_URL_PUBLICA: 'http://127.0.0.1:9000' })).toMatchObject({ ok: true });
  });

  it('CA-5: sem nenhuma, nomeia as cinco ordenadas; sem valores', () => {
    expect(lerConfigReal({})).toEqual({
      ok: false,
      variaveis: ['S3_ACCESS_KEY_ID', 'S3_BUCKET', 'S3_ENDPOINT', 'S3_REGIAO', 'S3_SECRET_ACCESS_KEY'],
    });
  });

  it.each([
    [{ S3_BUCKET: undefined }, ['S3_BUCKET']],
    [{ S3_ENDPOINT: 'ftp://x' }, ['S3_ENDPOINT']],
    [{ S3_ENDPOINT: 'nao-e-url' }, ['S3_ENDPOINT']],
    [{ S3_URL_PUBLICA: 'nao-e-url' }, ['S3_URL_PUBLICA']],
    [{ S3_URL_PUBLICA: 'http://cdn.exemplo.test' }, ['S3_URL_PUBLICA']],
    [{ S3_URL_PUBLICA: 'ftp://cdn.exemplo.test' }, ['S3_URL_PUBLICA']],
    [{ S3_FORCE_PATH_STYLE: 'sim' }, ['S3_FORCE_PATH_STYLE']],
    [{ S3_REGIAO: '  ' }, ['S3_REGIAO']],
  ])('inválida %j → %j', (extra, esperadas) => {
    const r = lerConfigReal({ ...BASE, ...extra });
    expect(r).toEqual({ ok: false, variaveis: esperadas });
    expect(JSON.stringify(r)).not.toContain('segredo-xyz');
  });
});
