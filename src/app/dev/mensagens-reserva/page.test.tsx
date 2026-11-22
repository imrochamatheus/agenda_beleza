/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoMensagensReserva, { dynamic, generateMetadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('página /dev/mensagens-reserva', () => {
  it('force-dynamic; metadados só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata().robots).toEqual({ index: false, follow: false });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it('desligada → 404 sem ler os parâmetros', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const lidos = vi.fn();
    const searchParams = { then: () => lidos() } as unknown as Promise<Record<string, string>>;
    await expect(DemonstracaoMensagensReserva({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it('ligada: 4 tipos × 7 estados, com um único h2 e a falha destacada por texto', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    render(await DemonstracaoMensagensReserva({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByRole('heading', { level: 2, name: 'Mensagens de WhatsApp' })).toHaveLength(1);
    expect(screen.getAllByRole('listitem').filter((li) => li.getAttribute('data-estado') !== null)).toHaveLength(28);
    expect(screen.getByText('Cancelamento enviado')).toBeTruthy();
    expect(screen.getByText('Falha ao enviar convite de avaliação por WhatsApp')).toBeTruthy();
    expect(screen.getByText('Link de avaliação indisponível.')).toBeTruthy();
  });

  it('?vista=vazia mostra o estado sem mensagens', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    render(await DemonstracaoMensagensReserva({ searchParams: Promise.resolve({ vista: 'vazia' }) }));
    expect(screen.getByText('Nenhuma mensagem de WhatsApp para esta reserva.')).toBeTruthy();
  });
});
