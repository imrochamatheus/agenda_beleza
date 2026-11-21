import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

// D-028 T-6 (CA-17, RN-13, R-5): garantias estáticas da agenda. Leem o código-fonte.

const RAIZ = process.cwd();

function arquivos(dir: string, filtro: (caminho: string) => boolean = () => true): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho, filtro);
    return /\.(ts|tsx)$/.test(nome) && filtro(caminho) ? [caminho] : [];
  });
}

const naoTeste = (p: string) => !/\.test\.tsx?$/.test(p);
const fonte = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => relative(RAIZ, p);

describe('CA-17: a página pública nunca importa a leitura da agenda', () => {
  const publicos = [
    ...arquivos(join(RAIZ, 'src/app/(publico)')),
    ...arquivos(join(RAIZ, 'src/server/reserva-publica')),
    ...arquivos(join(RAIZ, 'src/server/protecao')),
    ...arquivos(join(RAIZ, 'src/domain')),
    ...arquivos(join(RAIZ, 'src/server'), (p) => /publico[^/]*\.tsx?$/.test(p) && !p.includes('/agenda/')),
  ].filter(naoTeste);

  it('há arquivos públicos para conferir', () => {
    expect(publicos.length).toBeGreaterThan(10);
  });

  it('nenhum importa server/agenda, repos/agenda nem os componentes do painel da agenda', () => {
    const ofensores = publicos.filter((p) => /from '@\/(server\/agenda|server\/repos\/agenda|app\/painel\/agenda)|from '[^']*\/agenda\//.test(fonte(p)));
    expect(ofensores.map(rel)).toEqual([]);
  });
});

describe('RN-13: somente leitura', () => {
  const dosArquivos = [
    ...arquivos(join(RAIZ, 'src/server/agenda')),
    ...arquivos(join(RAIZ, 'src/app/painel/agenda')),
    ...arquivos(join(RAIZ, 'src/app/dev/agenda')),
    join(RAIZ, 'src/server/repos/agenda.ts'),
  ].filter(naoTeste);

  it('sem *.acao.ts, sem acoes.ts, sem "use server" e sem formulário POST', () => {
    expect(dosArquivos.filter((p) => /\.acao\.ts$|\/acoes\.ts$/.test(p))).toEqual([]);
    for (const p of dosArquivos) {
      const t = fonte(p);
      expect(t, rel(p)).not.toMatch(/['"]use server['"]/);
      expect(t, rel(p)).not.toMatch(/method=["']post["']/i);
    }
  });

  it('o repositório só lê: sem INSERT, UPDATE, DELETE nem escrita do Prisma', () => {
    const t = fonte(join(RAIZ, 'src/server/repos/agenda.ts')).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(t).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(t).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(/);
  });

  it('nenhuma checagem de suspensão (RN-4, CA-10)', () => {
    for (const p of dosArquivos) expect(fonte(p).replace(/\/\/.*$/gm, ''), rel(p)).not.toMatch(/suspens/i);
  });
});

describe('R-5: sem Date local nem formatação fora de format.ts', () => {
  const codigo = [
    ...arquivos(join(RAIZ, 'src/server/agenda')),
    ...arquivos(join(RAIZ, 'src/app/painel/agenda')),
    ...arquivos(join(RAIZ, 'src/app/dev/agenda')),
  ].filter(naoTeste);
  it('não usa métodos locais de Date, toLocale* nem Intl direto', () => {
    for (const p of codigo) {
      expect(fonte(p), rel(p)).not.toMatch(/\.(getHours|getMinutes|getDate|getDay|getMonth|getFullYear|setHours|toLocale\w*)\(|Intl\.|new Date\(\d/);
    }
  });
});
