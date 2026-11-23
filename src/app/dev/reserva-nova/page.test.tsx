/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoReservaNova, { dynamic, generateMetadata } from './page';

// D-029 / D-050: /dev/reserva-nova só com a vitrine ligada; modos gestor e profissional; vistas com 3 linhas.
afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

async function renderizar(params: Record<string, string | string[]> = {}) {
  render(await DemonstracaoReservaNova({ searchParams: Promise.resolve(params) }));
}

describe('página /dev/reserva-nova', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Nova reserva (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it.each([undefined, '', 'false', 'TRUE'])('desligada (VITRINE_COMPONENTES=%s) → 404 sem ler os parâmetros', async (valor) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', valor);
    const lidos = vi.fn();
    const searchParams = { then: (r: (v: unknown) => void) => { lidos(); r({}); } } as unknown as Promise<Record<string, string>>;
    await expect(DemonstracaoReservaNova({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('gestor: uma linha com seletor de profissional, serviços de exemplo e a hora da query', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ hora: '09:30' });
    expect(screen.getByRole('heading', { level: 1, name: 'Nova reserva' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Serviço 1' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Profissional' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Escova/ })).toBeTruthy();
    expect((screen.getByLabelText('Hora (HH:MM)') as HTMLInputElement).value).toBe('09:30');
  });

  it('modo profissional: sem seletor, "Ana Demonstração (você)"', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ modo: 'profissional' });
    expect(screen.queryByRole('combobox', { name: 'Profissional' })).toBeNull();
    expect(screen.getByText(/Ana Demonstração \(você\)/)).toBeTruthy();
  });

  it('?vista=encaixe: 3 linhas e o aviso com os 2 itens; ?vista=erros: resumo por linha', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'encaixe', data: '2026-12-01' });
    expect(screen.getAllByRole('group', { name: /^Serviço \d$/ })).toHaveLength(3);
    const aviso = screen.getByRole('alert');
    expect(within(aviso).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Serviço 2 — Hidratação com Bia Demonstração às 19:00: fora da jornada.',
      'Serviço 3 — Manicure com Carla Demonstração às 13:00: horário bloqueado; fora do funcionamento.',
    ]);
    cleanup();
    await renderizar({ vista: 'erros', data: '2026-12-01' });
    const links = Array.from(screen.getByRole('alert').querySelectorAll('a')).map((a) => a.textContent);
    expect(links).toEqual(['Serviço 2 — Hora: Informe a hora no formato HH:MM.', 'Serviço 3 — Serviço: Este serviço já está no Serviço 1.']);
  });

  it('?vista=criada: roteiro com os 3 serviços e o encaixe em 2', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'criada', data: '2026-12-01', modo: 'profissional' });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Reserva registrada com encaixe em 2 serviços.');
    expect(within(status).getAllByRole('listitem')).toHaveLength(3);
    expect(within(status).getByRole('link', { name: 'Ver na agenda' }).getAttribute('href')).toBe('/dev/agenda?data=2026-12-01&visao=dia');
  });
});
