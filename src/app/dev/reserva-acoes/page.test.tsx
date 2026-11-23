/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoReservaAcoes, { dynamic, generateMetadata } from './page';

// D-030/D-050: /dev/reserva-acoes só com a vitrine ligada; ações por item conforme a vista e a URL.
afterEach(() => vi.unstubAllEnvs());

async function renderizar(params: Record<string, string> = {}) {
  render(await DemonstracaoReservaAcoes({ searchParams: Promise.resolve(params) }));
}
const parada = (id: string) => within(document.getElementById(`item-${id}`)!);

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

  it('futura: remarcar/cancelar por item, item cancelado sem ações, total e "Cancelar todos"', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar();
    expect(parada('item-escova').getByRole('link', { name: /^Remarcar Escova/ }).getAttribute('href')).toBe('/dev/reserva-acoes?vista=futura&remarcar=item-escova#remarcar');
    expect(parada('item-hidratacao').queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: /Marcar/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Cancelar todos os serviços' })).toBeTruthy();
    expect(screen.getByText('Itens cancelados não entram no total.')).toBeTruthy();
    expect(Array.from(document.querySelectorAll('dl dt')).map((t) => t.textContent)).toEqual(['Cliente', 'Telefone', 'Data', 'Situação', 'Origem']);
  });

  it('?remarcar= abre um só formulário na parada; ?cancelar= e ?cancelar=todos abrem as confirmações', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ remarcar: 'item-escova' });
    expect(parada('item-escova').getByRole('heading', { level: 3, name: 'Remarcar Escova' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
    expect(document.getElementById('remarcar-data')!.textContent).toContain('a mesma dos outros serviços');
  });

  it('?cancelar=<item>', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ cancelar: 'item-manicure' });
    expect(parada('item-manicure').getByRole('button', { name: 'Sim, cancelar este serviço' })).toBeTruthy();
  });

  it('?cancelar=todos', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ cancelar: 'todos' });
    expect(document.getElementById('cancelar-todos')!.textContent).toContain('Cancelar os 2 serviços que ainda podem ser cancelados');
  });

  it('iniciada: botões de situação na parada que já começou', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'iniciada' });
    expect(parada('item-escova').getByRole('button', { name: 'Marcar Escova como concluído' })).toBeTruthy();
    expect(parada('item-escova').getByRole('button', { name: 'Marcar Escova como não compareceu' })).toBeTruthy();
  });

  it('profissional: só o próprio serviço, frase e total dos seus serviços, sem "Cancelar todos"', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'profissional' });
    expect(screen.getByText('Você vê apenas os seus serviços nesta reserva.')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Serviços da reserva' }).querySelectorAll('li')).toHaveLength(1);
    expect(screen.getByText(/Total dos seus serviços/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Cancelar todos os serviços' })).toBeNull();
  });

  it('cancelada: sem ações; resultado do PRG aparece com o texto do item', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'cancelada', resultado: 'cancelado', item: 'item-escova' });
    const servicos = within(screen.getByRole('region', { name: 'Serviços' }));
    expect(servicos.queryByRole('button')).toBeNull();
    expect(servicos.queryByRole('link')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/^Escova \(\d{2}:\d{2}\) foi cancelado\. A cliente será avisada/);
    expect(screen.getByText(/Total \(cancelada\)/)).toBeTruthy();
  });
});
