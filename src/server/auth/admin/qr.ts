import qrcode from 'qrcode-generator';

// QR do cadastro do TOTP (D-034 RN-6): SVG montado no servidor, sem JavaScript no cliente e sem
// requisição externa. Único arquivo que importa `qrcode-generator` (regra ESLint).

const MARGEM = 4;

/** SVG (módulos como um único <path>) com `role="img"` e `aria-label`. Sem URL no markup. */
export function gerarQrSvg(conteudo: string, rotulo: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(conteudo);
  qr.make();
  const n = qr.getModuleCount();
  let caminho = '';
  for (let l = 0; l < n; l += 1) {
    for (let c = 0; c < n; c += 1) {
      if (qr.isDark(l, c)) {
        caminho += `M${c + MARGEM} ${l + MARGEM}h1v1h-1z`;
      }
    }
  }
  const lado = n + MARGEM * 2;
  const rotuloSeguro = rotulo.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return (
    `<svg viewBox="0 0 ${lado} ${lado}" role="img" aria-label="${rotuloSeguro}" shape-rendering="crispEdges">` +
    `<rect width="${lado}" height="${lado}" fill="white"/><path d="${caminho}" fill="black"/></svg>`
  );
}
