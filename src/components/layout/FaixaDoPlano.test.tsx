/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/painel/_aviso/AvisoDoPlano', () => ({
  AvisoDoPlano: ({ papel }: { papel: string }) => <p data-testid="aviso-real">aviso:{papel}</p>,
}));

import { FaixaDoPlano } from './FaixaDoPlano';
import { PanelLayout } from './PanelLayout';

describe('FaixaDoPlano', () => {
  it('mostra o texto com role=status e rótulo visível', () => {
    render(<FaixaDoPlano aviso={{ tipo: 'aviso', texto: 'Assinatura suspensa.' }} />);
    const faixa = screen.getByRole('status');
    expect(faixa.textContent).toContain('Atenção:');
    expect(faixa.textContent).toContain('Assinatura suspensa.');
  });

  it('variante informativa usa o rótulo "Informação:"', () => {
    render(<FaixaDoPlano aviso={{ tipo: 'info', texto: 'Cancelada.' }} />);
    expect(screen.getByRole('status').textContent).toContain('Informação:');
  });
});

describe('FaixaDoPlano com link (D-040)', () => {
  it('mostra o link quando o aviso o traz e nenhum quando não', () => {
    const { rerender } = render(<FaixaDoPlano aviso={{ tipo: 'aviso', texto: 'Pendente.', link: { rotulo: 'Assinar agora', href: '/painel/assinatura' } }} />);
    expect(screen.getByRole('link', { name: 'Assinar agora' }).getAttribute('href')).toBe('/painel/assinatura');
    rerender(<FaixaDoPlano aviso={{ tipo: 'aviso', texto: 'Pendente.' }} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('PanelLayout e a faixa (R-2)', () => {
  it('sem `aviso`, renderiza o componente servidor com o papel, antes do conteúdo', () => {
    const { container } = render(
      <PanelLayout papel="profissional" nomeSalao="S">
        <p id="corpo">x</p>
      </PanelLayout>,
    );
    const main = container.querySelector('main')!;
    expect(main.firstElementChild?.getAttribute('data-testid')).toBe('aviso-real');
    expect(main.textContent).toContain('aviso:profissional');
    expect(main.lastElementChild?.id).toBe('corpo');
  });

  it('`aviso={null}` desliga a leitura e `aviso` informado a substitui', () => {
    const { container, rerender } = render(
      <PanelLayout papel="gestor" nomeSalao="S" aviso={null}>
        x
      </PanelLayout>,
    );
    expect(container.querySelector('[data-testid="aviso-real"]')).toBeNull();
    rerender(
      <PanelLayout papel="gestor" nomeSalao="S" aviso={<b>outro</b>}>
        x
      </PanelLayout>,
    );
    expect(container.querySelector('main')!.firstElementChild?.tagName).toBe('B');
  });
});
