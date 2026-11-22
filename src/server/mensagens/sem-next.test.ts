import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// D-043 CA-15: src/server/mensagens/ não importa next/* nem declara 'use server'; rotulos.ts é client-safe.
const DIR = join(process.cwd(), 'src/server/mensagens');
const fontes = readdirSync(DIR).filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n));

describe('src/server/mensagens', () => {
  it.each(fontes)('%s não importa next/* nem usa use server', (nome) => {
    const t = readFileSync(join(DIR, nome), 'utf8');
    expect(t).not.toMatch(/from 'next(\/|')/);
    expect(t).not.toMatch(/['"]use server['"]/);
  });

  it('rotulos.ts e situacao-tipos.ts só importam módulos client-safe', () => {
    for (const nome of ['rotulos.ts', 'situacao-tipos.ts']) {
      const imports = [...readFileSync(join(DIR, nome), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const i of imports) {
        expect(i, `${nome} importa ${i}`).toMatch(/^(\.\/|@\/server\/clientes\/tipos$)/);
      }
    }
  });
});
