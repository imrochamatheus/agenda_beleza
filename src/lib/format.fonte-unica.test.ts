import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// CA-10 (D-009 RN-11, D-8 ajustada): a formatação de exibição fica só em src/lib/format.ts.
const RAIZ = fileURLToPath(new URL('../', import.meta.url));

function listar(pasta: string): string[] {
  const saida: string[] = [];
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) saida.push(...listar(caminho));
    else if (/\.(ts|tsx)$/.test(entrada.name)) saida.push(caminho);
  }
  return saida;
}

/** Caminho relativo a src/, com '/' em qualquer sistema. */
const rel = (caminho: string) => relative(RAIZ, caminho).split(sep).join('/');

const ARQUIVOS = listar(RAIZ)
  .map((caminho) => ({ rel: rel(caminho), texto: readFileSync(caminho, 'utf8') }))
  .filter(
    (a) =>
      a.rel !== 'lib/format.ts' && !/\.test\.(ts|tsx)$/.test(a.rel) && !a.rel.startsWith('generated/'),
  );

const CAMADAS_DE_EXIBICAO = ['app/', 'components/', 'lib/', 'config/'];

function ocorrencias(padrao: RegExp, filtro: (rel: string) => boolean = () => true): string[] {
  return ARQUIVOS.filter((a) => filtro(a.rel) && padrao.test(a.texto)).map((a) => a.rel);
}

describe('CA-10: fonte única de formatação', () => {
  it('a varredura enxerga os arquivos de src/ (sanidade)', () => {
    const nomes = ARQUIVOS.map((a) => a.rel);
    expect(nomes).toContain('app/dev/mp-checkout/page.tsx');
    expect(nomes).toContain('server/env.ts');
    expect(nomes).not.toContain('lib/format.ts');
    expect(nomes.some((n) => n.startsWith('generated/'))).toBe(false);
  });

  it('nenhum toLocaleString/toLocaleDateString/toLocaleTimeString em src/', () => {
    expect(ocorrencias(/\btoLocale(Date|Time)?String\b/)).toEqual([]);
  });

  it('nenhum Intl.NumberFormat em src/', () => {
    expect(ocorrencias(/\bIntl\s*\.\s*NumberFormat\b/)).toEqual([]);
  });

  it('nenhum Intl.DateTimeFormat nas camadas de exibição (src/server pode usá-lo para cálculo)', () => {
    expect(
      ocorrencias(/\bIntl\s*\.\s*DateTimeFormat\b/, (r) =>
        CAMADAS_DE_EXIBICAO.some((c) => r.startsWith(c)),
      ),
    ).toEqual([]);
  });

  it('o /dev/mp-checkout usa formatarMoeda(dados.valorCentavos), sem dividir por 100', () => {
    const pagina = ARQUIVOS.find((a) => a.rel === 'app/dev/mp-checkout/page.tsx')!.texto;
    expect(pagina).toContain('formatarMoeda(dados.valorCentavos)');
    expect(pagina).not.toContain('/ 100');
    expect(pagina).not.toMatch(/\bIntl\b/);
  });
});
