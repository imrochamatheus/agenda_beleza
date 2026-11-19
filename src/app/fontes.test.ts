import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

// next/font/local é uma macro de compilação do Next (vazia fora do compilador; D-009 R-3).
// O dublê registra as opções para o teste conferi-las; não é dublê de banco.
const chamadas = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('next/font/local', () => ({
  default: (opcoes: Record<string, unknown>) => {
    chamadas.push(opcoes);
    return {
      className: `cls${String(opcoes.variable)}`,
      variable: `var${String(opcoes.variable)}`,
      style: { fontFamily: 'x' },
    };
  },
}));

const { fonteCorpo, fonteTitulo } = await import('./fontes');

const pasta = (nome: string) => fileURLToPath(new URL(`./${nome}`, import.meta.url));

describe('fontes (RN-6, D-2)', () => {
  it('declara as duas famílias com swap, variáveis CSS e fallbacks', () => {
    expect(chamadas).toHaveLength(2);
    const [titulo, corpo] = chamadas;
    expect(titulo).toMatchObject({
      src: './_fontes/fraunces-latin-opsz-normal.woff2',
      weight: '100 900',
      style: 'normal',
      display: 'swap',
      variable: '--fonte-titulo',
      fallback: ['Georgia', 'Times New Roman', 'serif'],
      adjustFontFallback: 'Times New Roman',
    });
    expect(corpo).toMatchObject({
      src: './_fontes/source-sans-3-latin-wght-normal.woff2',
      weight: '200 900',
      style: 'normal',
      display: 'swap',
      variable: '--fonte-corpo',
      fallback: ['system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
      adjustFontFallback: 'Arial',
    });
    expect(fonteTitulo.variable).toBe('var--fonte-titulo');
    expect(fonteCorpo.variable).toBe('var--fonte-corpo');
  });

  it.each([
    [
      'fraunces-latin-opsz-normal.woff2',
      '7234ed860a9cc83045413c4faee63c960a8f2d1917adcf728119307d56e0d783',
      'OFL-Fraunces.txt',
      'The Fraunces Project Authors',
    ],
    [
      'source-sans-3-latin-wght-normal.woff2',
      '19143dca075972bc84e3fd9eab7416dd40cc565dccb2435a044bdfabe060c7d5',
      'OFL-SourceSans3.txt',
      'Google Inc.',
    ],
  ])('%s: assinatura wOF2, sha256 conferido e licença OFL 1.1 ao lado', (arquivo, sha, licenca, autor) => {
    const bytes = readFileSync(pasta(`_fontes/${arquivo}`));
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);
    const texto = readFileSync(pasta(`_fontes/${licenca}`), 'utf8');
    expect(texto).toContain('SIL Open Font License, Version 1.1');
    expect(texto).toContain(autor);
  });

  it('não usa next/font/google nem servidor de fontes', () => {
    const fonte = readFileSync(pasta('fontes.ts'), 'utf8');
    expect(fonte).not.toMatch(/next\/font\/google|fonts\.googleapis|fonts\.gstatic/);
  });
});
