/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DOCUMENTOS } from '@/config/termos-documentos';
import { VERSAO_TERMOS } from '@/config/termos';

import PaginaPrivacidade, * as privacidade from '../privacidade/page';
import PaginaTermos, * as termos from '../termos/page';

afterEach(() => {
  vi.doUnmock('@/config/termos');
  vi.resetModules();
});

describe('CA-3: /termos e /privacidade', () => {
  it.each([
    ['termos', PaginaTermos, 'Termos de Uso'],
    ['privacidade', PaginaPrivacidade, 'Política de Privacidade'],
  ] as const)('%s: h1, versão, aviso provisório, vigência e rodapé', (_n, Pagina, titulo) => {
    render(<Pagina />);
    expect(screen.getByRole('heading', { level: 1, name: titulo })).toBeTruthy();
    expect(screen.getByText(new RegExp(`Versão ${VERSAO_TERMOS}`))).toBeTruthy();
    expect(screen.getByText(/Vigência a partir de 21\/11\/2026/)).toBeTruthy();
    const aviso = screen.getByRole('status');
    expect(aviso.textContent).toContain('provisório');
    const rodape = screen.getByRole('navigation', { name: 'Informações legais' });
    expect(within(rodape).getByRole('link', { name: 'Termos de Uso' }).getAttribute('href')).toBe('/termos');
    expect(within(rodape).getByRole('link', { name: 'Política de Privacidade' }).getAttribute('href')).toBe('/privacidade');
  });

  it('as páginas são estáticas (CA-21)', () => {
    expect(termos.dynamic).toBe('force-static');
    expect(privacidade.dynamic).toBe('force-static');
  });

  it('o índice liga a cada seção, que tem id', () => {
    render(<PaginaTermos />);
    const indice = screen.getByRole('navigation', { name: 'Índice do documento' });
    for (const s of DOCUMENTOS.termos.secoes) {
      expect(within(indice).getByRole('link', { name: s.titulo }).getAttribute('href')).toBe(`#${s.id}`);
      expect(document.getElementById(s.id)).not.toBeNull();
    }
  });
});

describe('CA-6: seção #avaliacoes da Privacidade', () => {
  it('existe e cita os termos exigidos', () => {
    render(<PaginaPrivacidade />);
    const secao = document.getElementById('avaliacoes');
    expect(secao).not.toBeNull();
    const texto = secao!.textContent ?? '';
    for (const termo of ['nota', 'comentário', 'primeiro nome', 'inicial', 'não compareceu', 'anonimização', 'moderação', 'denunciar', 'não edita nem apaga']) {
      expect(texto, termo).toContain(termo);
    }
  });

  it('cita o pedido de anonimização/remoção', () => {
    render(<PaginaPrivacidade />);
    expect(document.body.textContent).toMatch(/pedir[^.]*anonimização[^.]*remoção/);
  });
});

describe('CA-4: a versão trocada aparece nas páginas e vem do config', () => {
  it('re-render com outra VERSAO_TERMOS', async () => {
    vi.resetModules();
    vi.doMock('@/config/termos', async (original) => ({
      ...(await original<typeof import('@/config/termos')>()),
      VERSAO_TERMOS: 'versao-de-teste-9',
    }));
    const { default: Pagina } = await import('../termos/page');
    render(<Pagina />);
    expect(screen.getByText(/Versão versao-de-teste-9/)).toBeTruthy();
  });
});
