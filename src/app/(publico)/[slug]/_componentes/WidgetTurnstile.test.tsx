/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { WidgetTurnstile } from './WidgetTurnstile';

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('script').forEach((s) => s.remove());
});

const SIM = { modo: 'simulado', chaveDoSite: '', tokenSimulado: 'XXXX.DUMMY.TOKEN.XXXX', controleDeTeste: false } as const;

describe('WidgetTurnstile (CA-10, CA-13)', () => {
  it('simulado: campo oculto com o token documentado, sem script', () => {
    const { container } = render(<WidgetTurnstile dados={SIM} />);
    const campo = container.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement;
    expect(campo.type).toBe('hidden');
    expect(campo.value).toBe('XXXX.DUMMY.TOKEN.XXXX');
    expect(document.head.querySelector('script')).toBeNull();
  });

  it('controle de teste: seletor com token válido, inválido e ausente', () => {
    render(<WidgetTurnstile dados={{ ...SIM, controleDeTeste: true }} />);
    const sel = screen.getByLabelText(/Verificação simulada/) as HTMLSelectElement;
    expect(sel.name).toBe('cf-turnstile-response');
    expect(sel.value).toBe('XXXX.DUMMY.TOKEN.XXXX');
    expect([...sel.options].map((o) => o.text)).toEqual(['Token válido', 'Token inválido', 'Sem token']);
  });

  it('real: contêiner com a chave do site e o script oficial uma única vez', () => {
    const dados = { modo: 'real', chaveDoSite: '0xABC', tokenSimulado: '', controleDeTeste: false } as const;
    const { container, unmount } = render(<WidgetTurnstile dados={dados} />);
    expect(container.querySelector('.cf-turnstile')?.getAttribute('data-sitekey')).toBe('0xABC');
    unmount();
    render(<WidgetTurnstile dados={dados} />);
    expect(document.head.querySelectorAll('script[src^="https://challenges.cloudflare.com/turnstile"]')).toHaveLength(1);
  });
});
