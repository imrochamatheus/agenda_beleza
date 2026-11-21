import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// D-026 T-1: o módulo de serviço não conhece o Next (nem 'use server'): a casca fica em src/app/**.
const DIR = import.meta.dirname;
const FONTES = readdirSync(DIR).filter((n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n));

describe('src/server/reserva-publica', () => {
  it('enxerga os arquivos do módulo (sanidade)', () => {
    expect(FONTES).toEqual(expect.arrayContaining(['agendamento.ts', 'pagina.ts', 'passos.ts', 'servico.ts', 'tipos.ts']));
  });

  it.each(FONTES)('%s não importa next/* nem declara "use server"', (arquivo) => {
    const texto = readFileSync(join(DIR, arquivo), 'utf8');
    expect(texto).not.toMatch(/from ['"]next(\/|['"])/);
    expect(texto).not.toMatch(/^['"]use server['"]/m);
  });

  it('agendamento.ts e tipos.ts não têm imports de runtime', () => {
    for (const arquivo of ['agendamento.ts', 'tipos.ts']) {
      const importacoes = readFileSync(join(DIR, arquivo), 'utf8').match(/^import (?!type).*$/gm) ?? [];
      expect(importacoes, arquivo).toEqual([]);
    }
  });
});
