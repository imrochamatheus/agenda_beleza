/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MENSAGENS_FOTO } from '@/server/fotos/tipos';

import DemonstracaoFotos, { dynamic, generateMetadata } from './page';

// D-021 T-11: /dev/fotos só com a vitrine ligada; n fotos de exemplo; ?envio= e ?acao= de lista fechada.

afterEach(() => {
  vi.unstubAllEnvs();
});

const renderizar = async (params: Record<string, string> = {}) => render(await DemonstracaoFotos({ searchParams: Promise.resolve(params) }));

describe('página /dev/fotos', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Fotos do salão (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it('desligada → 404 sem ler os parâmetros', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const lidos = vi.fn();
    const searchParams = {
      then: (resolver: (v: unknown) => void) => {
        lidos();
        resolver({});
      },
    } as unknown as Promise<Record<string, string>>;
    await expect(DemonstracaoFotos({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('ligada: 3 fotos por padrão, ?n= escolhe (máx. 12), com 12 o formulário some', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const a = await renderizar();
    expect(screen.getByText('3 de 12 fotos')).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(a.container.querySelector('input[type="file"]')).not.toBeNull();
    a.unmount();
    const b = await renderizar({ n: '99' });
    expect(screen.getByText('12 de 12 fotos')).toBeTruthy();
    expect(b.container.querySelector('input[type="file"]')).toBeNull();
    b.unmount();
    await renderizar({ n: '0' });
    expect(screen.getByText('O salão ainda não tem fotos.')).toBeTruthy();
  });

  it('?envio= e ?acao= mostram a mensagem; valor desconhecido não mostra nada', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const a = await renderizar({ envio: 'tipo' });
    expect(screen.getAllByText(MENSAGENS_FOTO.tipo).length).toBeGreaterThan(0);
    a.unmount();
    const b = await renderizar({ acao: 'removida' });
    expect(screen.getByText(MENSAGENS_FOTO.removida)).toBeTruthy();
    b.unmount();
    const { container } = await renderizar({ envio: 'xyz', acao: 'abc' });
    expect(container.querySelector('#resultado-fotos')).toBeNull();
  });
});
