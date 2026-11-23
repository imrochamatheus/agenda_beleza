/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoReserva, { dynamic, generateMetadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
});

const renderizar = async (params: Record<string, string | string[]> = {}) => render(await DemonstracaoReserva({ searchParams: Promise.resolve(params) }));

describe('página /dev/reserva (CA-12)', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Reserva (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it('desligada: 404 sem ler os parâmetros', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const lidos = vi.fn();
    const searchParams = {
      then: (resolver: (v: unknown) => void) => {
        lidos();
        resolver({});
      },
    } as unknown as Promise<Record<string, string>>;
    await expect(DemonstracaoReserva({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('ligada: perfil de exemplo e passo de serviços; vistas indisponível e vazia', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const { unmount } = await renderizar();
    expect(screen.getByRole('heading', { level: 1, name: /Studio Bela/ })).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    unmount();
    const indisponivel = await renderizar({ vista: 'indisponivel' });
    expect(screen.getByText('Agendamento indisponível')).toBeTruthy();
    expect(indisponivel.container.querySelector('form')).toBeNull();
    indisponivel.unmount();
    const vazio = await renderizar({ vista: 'vazio' });
    expect(vazio.container.textContent).not.toMatch(/undefined|null/);
    expect(screen.queryByRole('heading', { name: 'Endereço' })).toBeNull();
  });

  it('vistas do exemplo D-050: reescolha, confirmada e conflito', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const reescolha = await renderizar({ vista: 'reescolha' });
    expect(screen.getByRole('heading', { level: 2, name: 'Escolha outro horário para Hidratação' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: /Nome/ }) as HTMLInputElement).value).toBe('Maria Souza');
    expect(new Set((screen.getAllByRole('radio') as HTMLInputElement[]).map((r) => r.name))).toEqual(new Set(['h1']));
    reescolha.unmount();
    const confirmada = await renderizar({ vista: 'confirmada' });
    expect(screen.getByText('Reserva confirmada!')).toBeTruthy();
    expect(confirmada.container.textContent).toMatch(/TotalR\$\s205,00/);
    confirmada.unmount();
    await renderizar({ vista: 'conflito' });
    expect(screen.getByRole('heading', { level: 2, name: 'Hidratação' })).toBeTruthy();
    expect(screen.getByText('Os horários de Hidratação neste dia coincidem com os serviços que você já escolheu.')).toBeTruthy();
  });

  it('D-051 (CA-17): passo 0 sem dia, com dia marcado e semana vazia', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const s = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    const comS = (extra: Record<string, string>): Record<string, string | string[]> => ({ s, ...extra });
    const semDia = await renderizar(comS({}));
    expect(screen.getByRole('heading', { level: 2, name: 'Escova' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Escolha o dia' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Escolha um dia para ver os horários' })).toBeTruthy();
    expect(semDia.container.querySelector('[aria-current="date"]')).toBeNull();
    const primeiroLink = semDia.container.querySelector('ol a')!.getAttribute('href')!;
    const data = new URL(primeiroLink, 'http://l').searchParams.get('data')!;
    semDia.unmount();
    const comDia = await renderizar(comS({ data }));
    expect(comDia.container.querySelector('[aria-current="date"]')?.textContent).toContain(data.split('-').reverse().join('/'));
    expect(screen.getByRole('list', { name: 'Seu dia' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Escolher outro dia' })).toBeNull();
    comDia.unmount();
    const vazia = await renderizar(comS({ vista: 'semana-vazia' }));
    expect(vazia.container.querySelectorAll('ol a')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 3, name: 'Nenhum dia desta semana tem horário' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Próxima semana' })).toBeTruthy();
  });
});
