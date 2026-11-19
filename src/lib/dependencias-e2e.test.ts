import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// CA-15 (D-009 RN-23, R-5): o motor de regras do axe fica fixado. Uma versão nova do axe-core
// pode acrescentar regras e reprovar o gate sem mudança nossa; atualizar é decisão explícita.
const ler = (nome: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../${nome}`, import.meta.url)), 'utf8'));

const pacote = ler('package.json') as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const lock = ler('package-lock.json') as {
  packages: Record<string, { version?: string; dev?: boolean }>;
};

describe('CA-15: dependências do E2E de acessibilidade', () => {
  it.each(['@axe-core/playwright', 'axe-core'])('%s 4.14.0 exato em devDependencies', (nome) => {
    expect(pacote.devDependencies[nome]).toBe('4.14.0');
    expect(pacote.devDependencies[nome]).not.toMatch(/^[\^~]/);
    expect(pacote.dependencies[nome]).toBeUndefined();
  });

  it('o lock resolve uma única cópia de cada, nas versões exatas', () => {
    expect(lock.packages['node_modules/@axe-core/playwright']?.version).toBe('4.14.0');
    expect(lock.packages['node_modules/axe-core']?.version).toBe('4.14.0');
    expect(lock.packages['node_modules/@axe-core/playwright']?.dev).toBe(true);
    const copias = Object.keys(lock.packages).filter((k) => /(^|\/)axe-core$|@axe-core\//.test(k));
    expect(copias.sort()).toEqual(['node_modules/@axe-core/playwright', 'node_modules/axe-core']);
  });
});
