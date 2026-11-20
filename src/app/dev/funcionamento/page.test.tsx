/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MENSAGENS_FUNCIONAMENTO as M } from '@/server/salao/funcionamento-tipos';

import DemonstracaoFuncionamento, { dynamic, generateMetadata } from './page';

// D-020 T-12: /dev/funcionamento só com a vitrine ligada; semana de exemplo e os dois avisos.

afterEach(() => {
  vi.unstubAllEnvs();
});

const renderizar = async (params: Record<string, string> = {}) => render(await DemonstracaoFuncionamento({ searchParams: Promise.resolve(params) }));

describe('página /dev/funcionamento', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Horário de funcionamento (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
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
    await expect(DemonstracaoFuncionamento({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('ligada: semana de exemplo, sem aviso; ?modo=nao-informado e ?modo=fechado mostram os avisos', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const r1 = await renderizar();
    expect(screen.getByRole('heading', { level: 1, name: 'Horário de funcionamento' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: M.opcaoInformar }) as HTMLInputElement).checked).toBe(true);
    const detalhes = [...document.querySelectorAll('details')];
    expect(detalhes[0].querySelector('summary')!.textContent).toContain('09:00–19:00');
    expect(detalhes[5].querySelector('summary')!.textContent).toContain('09:00–14:00');
    expect(detalhes[6].querySelector('summary')!.textContent).toContain(M.fechado);
    expect(screen.queryByText(M.naoInformado)).toBeNull();
    expect(screen.queryByText(M.todosFechados)).toBeNull();
    r1.unmount();
    const r2 = await renderizar({ modo: 'nao-informado' });
    expect(screen.getByText(M.naoInformado)).toBeTruthy();
    expect((screen.getByRole('radio', { name: M.opcaoNaoInformar }) as HTMLInputElement).checked).toBe(true);
    r2.unmount();
    await renderizar({ modo: 'fechado' });
    expect(screen.getByText(M.todosFechados)).toBeTruthy();
  });
});
