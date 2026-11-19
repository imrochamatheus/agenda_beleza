// Fontes do tema (D-009 RN-6, D-2): arquivos locais versionados em ./_fontes (OFL 1.1), sem
// requisição a servidor de fontes no build nem em execução. Só o layout raiz importa este módulo.
// Os nomes das constantes viram os nomes das famílias no CSS gerado pelo next/font.
import localFont from 'next/font/local';

/** Fraunces (serifada, eixo óptico): títulos. */
export const fonteTitulo = localFont({
  src: './_fontes/fraunces-latin-opsz-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--fonte-titulo',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
  adjustFontFallback: 'Times New Roman',
});

/** Source Sans 3 (sem serifa, humanista): corpo e controles. */
export const fonteCorpo = localFont({
  src: './_fontes/source-sans-3-latin-wght-normal.woff2',
  weight: '200 900',
  style: 'normal',
  display: 'swap',
  variable: '--fonte-corpo',
  fallback: ['system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
  adjustFontFallback: 'Arial',
});
