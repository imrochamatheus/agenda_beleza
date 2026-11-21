/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoReservaAcoes, { dynamic, generateMetadata } from './page';

// D-030: /dev/reserva-acoes só com a vitrine ligada; as ações visíveis dependem da vista.
afterEach(() => vi.unstubAllEnvs());

async function renderizar(params: Record<string, string> = {}) {
  render(await DemonstracaoReservaAcoes({ searchParams: Promise.resolve(params) }));
}

describe('página /dev/reserva-acoes', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toMatchObject({ robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it.each([undefined, '', 'false', 'TRUE'])('desligada (VITRINE_COMPONENTES=%s) → 404', async (valor) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', valor);
    await expect(DemonstracaoReservaAcoes({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('futura: remarcar e cancelar, sem marcar situação', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar();
    expect(screen.getByRole('button', { name: 'Remarcar reserva' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar reserva' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Marcar como/ })).toBeNull();
  });

  it('iniciada: também marcar situação; concluída: só não compareceu; cancelada e resultado: nenhuma ação', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'iniciada' });
    expect(screen.getByRole('button', { name: 'Marcar como concluída' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Marcar como não compareceu' })).toBeTruthy();
  });

  it('concluída oferece só "não compareceu"', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'concluida' });
    expect(screen.queryByRole('button', { name: 'Marcar como concluída' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Marcar como não compareceu' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remarcar reserva' })).toBeNull();
  });

  it('cancelada e resultado de sucesso: sem ações; o resultado aparece', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'cancelada', resultado: 'cancelada' });
    expect(screen.queryByRole('button', { name: /Remarcar|Cancelar|Marcar/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Reserva cancelada.');
  });
});
