import { describe, expect, it } from 'vitest';

import { gerarQrSvg } from './qr';
import { uriOtpauth } from './totp';

describe('gerarQrSvg (CA-2)', () => {
  const svg = gerarQrSvg(uriOtpauth('admin@exemplo.test', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), 'QR "do" <app>');
  it('gera SVG acessível, determinístico e sem URL nem script', () => {
    expect(svg).toMatch(/^<svg viewBox="0 0 \d+ \d+" role="img" aria-label="QR &#34;do&#34; &#60;app&#62;"/);
    expect(svg).toContain('<path d="M');
    expect(svg).not.toMatch(/http|<script|href|src=/i);
    expect(gerarQrSvg('x', 'a')).toBe(gerarQrSvg('x', 'a'));
  });
  it('o QR cresce com o conteúdo', () => {
    const lado = (s: string) => Number(/viewBox="0 0 (\d+)/.exec(s)![1]);
    expect(lado(gerarQrSvg('x'.repeat(200), 'a'))).toBeGreaterThan(lado(gerarQrSvg('x', 'a')));
  });
});
