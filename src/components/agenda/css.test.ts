import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// D-043 (web-design §9.1): cores só por tokens; nenhum literal fora do :root, nenhum @media novo.
const arquivos = ['src/components/agenda/SituacaoMensagens.module.css', 'src/app/painel/agenda/_componentes/Agenda.module.css'];

describe.each(arquivos)('%s', (arq) => {
  const css = readFileSync(join(process.cwd(), arq), 'utf8');
  it('sem cor literal', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/);
  });
  it('no máximo o breakpoint único de 48rem', () => {
    const medias = [...css.matchAll(/@media[^{]+/g)].map((m) => m[0].trim());
    expect(medias.every((m) => m === '@media (min-width: 48rem)')).toBe(true);
  });
});
