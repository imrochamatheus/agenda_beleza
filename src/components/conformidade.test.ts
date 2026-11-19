import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// CA-20 e varreduras da D-009 §3.12: lê os arquivos (D-8). Testes ficam fora da varredura.
const SRC = fileURLToPath(new URL('../', import.meta.url));

function listar(pasta: string, extensoes: RegExp): string[] {
  const saida: string[] = [];
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) saida.push(...listar(caminho, extensoes));
    else if (extensoes.test(entrada.name) && !/\.test\.(ts|tsx)$/.test(entrada.name)) saida.push(caminho);
  }
  return saida;
}

type Arquivo = { rel: string; texto: string };
const ler = (caminho: string): Arquivo => ({
  rel: relative(SRC, caminho).split(sep).join('/'),
  texto: readFileSync(caminho, 'utf8'),
});

const PASTAS_DE_UI = ['components', 'app/dev/componentes'];
const UI: Arquivo[] = PASTAS_DE_UI.flatMap((p) => listar(join(SRC, p), /\.(ts|tsx|css)$/)).map(ler);
const CSS_DE_SRC: Arquivo[] = listar(SRC, /\.css$/).map(ler);

const semComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Os 148 nomes de cor do CSS Color 4 (transparent e currentColor são permitidos).
const NOMES_DE_COR = `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan
darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen
darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite
forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink
indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral
lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
paleturquoise palevioletred papayawhip peru pink plum powderblue purple rebeccapurple red rosybrown
royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray
slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke
yellow yellowgreen`.split(/\s+/);

const HEX_DE_COR = /(?:^|[\s:,(='"])#[0-9a-fA-F]{3,8}\b/;
const FUNCAO_DE_COR = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const NOME_DE_COR = new RegExp(`:\\s*(?:[^;{}]*\\s)?(${NOMES_DE_COR.join('|')})\\b\\s*[;}!]`, 'i');

/** Literais de cor encontrados num texto (já sem comentários). */
function literaisDeCor(texto: string): string[] {
  const achados: string[] = [];
  const hex = HEX_DE_COR.exec(texto);
  if (hex) achados.push(hex[0].trim());
  const funcao = FUNCAO_DE_COR.exec(texto);
  if (funcao) achados.push(funcao[0]);
  const nome = NOME_DE_COR.exec(texto);
  if (nome) achados.push(nome[1]);
  return achados;
}

/** Media queries de largura que não são exatamente (min-width: 48rem). */
function quebrasForaDoPadrao(css: string): string[] {
  return [...css.matchAll(/@media\s*([^{]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((q) => /(min|max)-width|width\s*[<>]/.test(q) && q !== '(min-width: 48rem)');
}

const OUTLINE_REMOVIDO = /outline\s*:\s*(none|0)\b/;

describe('auxiliares da varredura (sanidade: mutações do T-9)', () => {
  it('detecta cor literal em CSS e TSX', () => {
    expect(literaisDeCor('.a { color: #fff; }')).toEqual(['#fff']);
    expect(literaisDeCor('.a { background: rgb(0 0 0); }')).toEqual(['rgb(']);
    expect(literaisDeCor('.a { color: white; }')).toEqual(['white']);
    expect(literaisDeCor('.a { border: 1px solid red; }')).toEqual(['red']);
    expect(literaisDeCor(`style={{ color: '#3b2f2a' }}`)).toEqual(["'#3b2f2a"]);
  });

  it('não acusa tokens, transparent, currentColor, ids nem âncoras', () => {
    expect(
      literaisDeCor(
        '.a { color: var(--cor-texto); background: transparent; border-color: currentColor; } .b { display: grid; }',
      ),
    ).toEqual([]);
    expect(literaisDeCor('href={`#${ID_CONTEUDO}`} aria-describedby="motivo-bloqueio"')).toEqual([]);
  });

  it('detecta ponto de quebra fora do padrão e outline removido', () => {
    expect(quebrasForaDoPadrao('@media (min-width: 600px) { }')).toEqual(['(min-width: 600px)']);
    expect(quebrasForaDoPadrao('@media (max-width: 48rem) { }')).toEqual(['(max-width: 48rem)']);
    expect(quebrasForaDoPadrao('@media (min-width: 48rem) { } @media (prefers-reduced-motion: reduce) { }')).toEqual(
      [],
    );
    expect(OUTLINE_REMOVIDO.test('.a:focus { outline: none; }')).toBe(true);
    expect(OUTLINE_REMOVIDO.test('.a:focus { outline: 0 }')).toBe(true);
    expect(OUTLINE_REMOVIDO.test('.a:focus { outline: 3px solid var(--cor-foco); }')).toBe(false);
  });
});

describe('CA-20: conformidade de src/components e src/app/dev/componentes', () => {
  it('a varredura enxerga os arquivos (sanidade)', () => {
    const nomes = UI.map((a) => a.rel);
    expect(nomes).toEqual(
      expect.arrayContaining([
        'components/ui/Button.tsx',
        'components/ui/Button.module.css',
        'components/layout/Layout.module.css',
        'app/dev/componentes/page.tsx',
        'app/dev/componentes/Vitrine.module.css',
      ]),
    );
    expect(nomes.some((n) => n.endsWith('.test.tsx'))).toBe(false);
    expect(CSS_DE_SRC.map((a) => a.rel)).toContain('app/globals.css');
  });

  it('nenhum literal de cor (#hex, rgb()/hsl()…, nome de cor)', () => {
    const achados = UI.flatMap((a) => literaisDeCor(semComentarios(a.texto)).map((l) => `${a.rel}: ${l}`));
    expect(achados).toEqual([]);
  });

  it('globals.css: literais de cor só dentro do :root', () => {
    const css = semComentarios(CSS_DE_SRC.find((a) => a.rel === 'app/globals.css')!.texto);
    const inicio = css.search(/:root\s*\{/);
    const fim = css.indexOf('}', inicio);
    expect(literaisDeCor(css.slice(0, inicio) + css.slice(fim + 1))).toEqual([]);
    expect(literaisDeCor(css.slice(inicio, fim)).length).toBeGreaterThan(0);
  });

  it('todo CSS de src/: só @media (min-width: 48rem) para largura e nenhum outline removido', () => {
    for (const a of CSS_DE_SRC) {
      const css = semComentarios(a.texto);
      expect(quebrasForaDoPadrao(css), a.rel).toEqual([]);
      expect(OUTLINE_REMOVIDO.test(css), a.rel).toBe(false);
    }
  });

  it('nenhum dangerouslySetInnerHTML (RN-24)', () => {
    expect(UI.filter((a) => a.texto.includes('dangerouslySetInnerHTML')).map((a) => a.rel)).toEqual([]);
  });

  it('nenhum import de @/server em tempo de execução, salvo vitrineHabilitada na página (RN-24)', () => {
    const indevidos = UI.flatMap((a) =>
      [...a.texto.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"](@\/server\/[^'"]+)['"]/gm)]
        .filter((m) => !(a.rel === 'app/dev/componentes/page.tsx' && /\{\s*vitrineHabilitada\s*\}/.test(m[0])))
        .map((m) => `${a.rel}: ${m[1]}`),
    );
    expect(indevidos).toEqual([]);
  });

  it('nenhum tabIndex positivo (RN-8)', () => {
    const positivos = UI.filter((a) => /tabIndex=\{\s*[1-9]\d*\s*\}|tabindex="[1-9]\d*"/i.test(a.texto)).map(
      (a) => a.rel,
    );
    expect(positivos).toEqual([]);
  });
});
