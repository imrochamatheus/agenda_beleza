/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';

import DemonstracaoConfiguracoes, { dynamic, generateMetadata } from './page';

// D-017 T-9: /dev/configuracoes só com a vitrine ligada; valores padrão; `?fuso=alias`.

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderizar(params: Record<string, string | string[]> = {}) {
  render(await DemonstracaoConfiguracoes({ searchParams: Promise.resolve(params) }));
}

describe('página /dev/configuracoes', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Configurações (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it.each([undefined, '', 'false', 'TRUE'])('desligada (VITRINE_COMPONENTES=%s) → 404 sem ler os parâmetros', async (valor) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', valor);
    const lidos = vi.fn();
    const searchParams = {
      then: (resolver: (v: unknown) => void) => {
        lidos();
        resolver({});
      },
    } as unknown as Promise<Record<string, string>>;
    await expect(DemonstracaoConfiguracoes({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('ligada: dois formulários com os valores padrão, endereço atual e o anterior', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar();
    expect(screen.getByRole('heading', { level: 1, name: 'Configurações' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Nome do salão' }) as HTMLInputElement).value).toBe('Studio Exemplo');
    expect((screen.getByRole('combobox', { name: 'Fuso horário' }) as HTMLSelectElement).value).toBe('America/Sao_Paulo');
    expect((screen.getByRole('combobox', { name: 'Grade de horários (minutos)' }) as HTMLSelectElement).value).toBe('15');
    expect((screen.getByRole('textbox', { name: 'Antecedência mínima (horas)' }) as HTMLInputElement).value).toBe('2');
    expect(screen.getByText('/studio-exemplo')).toBeTruthy();
    const anteriores = screen.getByRole('region', { name: 'Endereços anteriores' });
    expect(within(anteriores).getByRole('listitem').textContent).toBe('/studio-antigo');
    expect(screen.queryByText(M.semAnteriores)).toBeNull();
  });

  it('?fuso=alias: Brazil/East como opção "(atual)" selecionada', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ fuso: 'alias' });
    const fuso = screen.getByRole('combobox', { name: 'Fuso horário' }) as HTMLSelectElement;
    expect(fuso.value).toBe('Brazil/East');
    expect(fuso.options[0].textContent).toBe('Brazil/East (atual)');
  });
});
