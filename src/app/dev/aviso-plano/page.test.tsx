/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoAvisoPlano, { dynamic, generateMetadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
});

const renderizar = async (params: Record<string, string> = {}) =>
  render(await DemonstracaoAvisoPlano({ searchParams: Promise.resolve(params) }));

describe('página /dev/aviso-plano', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toMatchObject({ robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it('desligada → 404 sem ler os parâmetros', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const lidos = vi.fn();
    const searchParams = {
      then: (r: (v: unknown) => void) => {
        lidos();
        r({});
      },
    } as unknown as Promise<Record<string, string>>;
    await expect(DemonstracaoAvisoPlano({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('estado e papel escolhidos; a data usa o fuso do salão (virada de dia)', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ estado: 'em_carencia' });
    expect(screen.getByRole('status').textContent).toContain('até 30/11/2026;');
  });

  it('padrão (sem assinatura) e valores inválidos: sem faixa; papel profissional', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ estado: '__proto__', papel: 'x' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('profissional vê o texto sem a frase do suporte', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ estado: 'manual', papel: 'profissional' });
    expect(screen.getByRole('status').textContent).toContain('Fale com o gestor do salão.');
  });
});
