import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// CA-13 (RN-3, RN-5) e RN-6/RN-7: lê o tema e confere contraste WCAG 2.x, paleta e tokens.
const CSS = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');
const SEM_COMENTARIOS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function blocoRoot(): { inicio: number; fim: number; corpo: string } {
  const inicio = SEM_COMENTARIOS.search(/:root\s*\{/);
  const abre = SEM_COMENTARIOS.indexOf('{', inicio);
  const fim = SEM_COMENTARIOS.indexOf('}', abre);
  return { inicio, fim, corpo: SEM_COMENTARIOS.slice(abre + 1, fim) };
}

const ROOT = blocoRoot();
const TOKENS = new Map(
  [...ROOT.corpo.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);
const CORES = [...TOKENS].filter(([nome]) => nome.startsWith('--cor-'));

function cor(nome: string): string {
  const valor = TOKENS.get(`--cor-${nome}`);
  if (!valor) throw new Error(`token --cor-${nome} ausente`);
  return valor;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Luminância relativa (WCAG 2.x). */
function luminancia(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Matiz (graus) e saturação (0..1) em HSL. */
function hsl(hex: string): { h: number; s: number } {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0 };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return { h: (h * 60 + 360) % 360, s };
}

describe('auxiliares de cálculo (sanidade)', () => {
  it('contraste preto/branco = 21 e igual/igual = 1', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contraste('#777777', '#777777')).toBe(1);
  });

  it('hsl de cores conhecidas', () => {
    expect(hsl('#ff0000')).toEqual({ h: 0, s: 1 });
    expect(hsl('#00ff00').h).toBeCloseTo(120);
    expect(hsl('#0000ff').h).toBeCloseTo(240);
    expect(hsl('#ff69b4').h).toBeGreaterThan(290); // hotpink: seria recusado
    expect(hsl('#808080')).toEqual({ h: 0, s: 0 });
  });
});

describe('CA-13: tokens de cor', () => {
  it('existe o conjunto mínimo de papéis de cor (RN-5)', () => {
    for (const nome of [
      'fundo',
      'superficie',
      'superficie-alt',
      'texto',
      'texto-suave',
      'borda-controle',
      'primaria',
      'primaria-forte',
      'sobre-primaria',
      'perigo',
      'perigo-forte',
      'sobre-perigo',
      'foco',
      'info-fundo',
      'info-texto',
      'sucesso-fundo',
      'sucesso-texto',
      'aviso-fundo',
      'aviso-texto',
      'erro-fundo',
      'erro-texto',
    ]) {
      expect(TOKENS.has(`--cor-${nome}`), nome).toBe(true);
    }
  });

  it('todo token de cor é #rrggbb', () => {
    expect(CORES.length).toBeGreaterThanOrEqual(21);
    for (const [nome, valor] of CORES) expect(valor, nome).toMatch(/^#[0-9a-f]{6}$/i);
  });

  const TEXTO = 4.5;
  const NAO_TEXTO = 3;
  const PARES: [string, string, number][] = [
    ...['fundo', 'superficie', 'superficie-alt'].flatMap((f): [string, string, number][] => [
      ['texto', f, TEXTO],
      ['texto-suave', f, TEXTO],
      ['primaria-forte', f, TEXTO],
      ['borda-controle', f, NAO_TEXTO],
      ['foco', f, NAO_TEXTO],
    ]),
    ['erro-texto', 'fundo', TEXTO],
    ['erro-texto', 'superficie', TEXTO],
    ['sobre-primaria', 'primaria', TEXTO],
    ['sobre-primaria', 'primaria-forte', TEXTO],
    ['sobre-perigo', 'perigo', TEXTO],
    ['sobre-perigo', 'perigo-forte', TEXTO],
    ['info-texto', 'info-fundo', TEXTO],
    ['sucesso-texto', 'sucesso-fundo', TEXTO],
    ['aviso-texto', 'aviso-fundo', TEXTO],
    ['erro-texto', 'erro-fundo', TEXTO],
    ['foco', 'primaria', NAO_TEXTO],
    ['foco', 'perigo', NAO_TEXTO],
    ['primaria', 'fundo', NAO_TEXTO],
    ['primaria', 'superficie', NAO_TEXTO],
  ];

  it.each(PARES)('%s sobre %s ≥ %d:1', (frente, fundo, minimo) => {
    expect(contraste(cor(frente), cor(fundo))).toBeGreaterThanOrEqual(minimo);
  });

  it('sem rosa genérico: nenhum token com matiz em [290°, 360°) e saturação ≥ 20% (D-9)', () => {
    for (const [nome, valor] of CORES) {
      const { h, s } = hsl(valor);
      expect(h >= 290 && h < 360 && s >= 0.2, `${nome} ${valor} h=${h.toFixed(1)} s=${s.toFixed(2)}`).toBe(
        false,
      );
    }
  });

  it('nenhum literal de cor fora do :root', () => {
    const fora = SEM_COMENTARIOS.slice(0, ROOT.inicio) + SEM_COMENTARIOS.slice(ROOT.fim + 1);
    expect(fora).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(fora).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
  });
});

describe('RN-6 / RN-7: tipografia, espaçamento, foco e movimento', () => {
  it('escala de espaçamento em rem (base 0,25 rem) e raio padrão', () => {
    const esperado: Record<string, string> = {
      '--espaco-1': '0.25rem',
      '--espaco-2': '0.5rem',
      '--espaco-3': '0.75rem',
      '--espaco-4': '1rem',
      '--espaco-6': '1.5rem',
      '--espaco-8': '2rem',
      '--espaco-12': '3rem',
      '--espaco-16': '4rem',
      '--raio': '0.5rem',
    };
    for (const [nome, valor] of Object.entries(esperado)) expect(TOKENS.get(nome), nome).toBe(valor);
  });

  it('alvo mínimo de 44 px e foco de pelo menos 2 px', () => {
    expect(TOKENS.get('--alvo-minimo')).toBe('2.75rem');
    expect(parseFloat(TOKENS.get('--foco-largura') ?? '0')).toBeGreaterThanOrEqual(2);
    expect(TOKENS.get('--foco-largura')).toMatch(/px$/);
  });

  it('corpo com 16 px e controles com pelo menos 16 px', () => {
    expect(TOKENS.get('--texto-base')).toBe('1rem');
    expect(SEM_COMENTARIOS).toMatch(/body\s*\{[^}]*font-size:\s*var\(--texto-base\)/);
    expect(SEM_COMENTARIOS).toMatch(
      /input,\s*select,\s*textarea,\s*button\s*\{[^}]*font-size:\s*max\(1rem,/,
    );
  });

  it('títulos com a fonte serifada e corpo com a sem serifa', () => {
    expect(SEM_COMENTARIOS).toMatch(/h1,\s*h2,\s*h3\s*\{[^}]*font-family:\s*var\(--fonte-titulo\)/);
    expect(SEM_COMENTARIOS).toMatch(/body\s*\{[^}]*font-family:\s*var\(--fonte-corpo\)/);
  });

  it(':focus-visible com contorno sólido na cor de foco', () => {
    expect(SEM_COMENTARIOS).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*var\(--foco-largura\)\s+solid\s+var\(--cor-foco\)/,
    );
    expect(SEM_COMENTARIOS).not.toMatch(/outline:\s*(none|0)\b/);
  });

  it('só tema claro e movimento reduzido respeitado', () => {
    expect(ROOT.corpo).toMatch(/color-scheme:\s*light/);
    expect(SEM_COMENTARIOS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*transition:\s*none !important;[^@]*animation:\s*none !important;/,
    );
  });

  it('documenta o ponto de quebra de 48rem e a classe .visualmente-oculto existe', () => {
    expect(CSS).toContain('48rem');
    expect(SEM_COMENTARIOS).toMatch(/\.visualmente-oculto\s*\{/);
  });
});
