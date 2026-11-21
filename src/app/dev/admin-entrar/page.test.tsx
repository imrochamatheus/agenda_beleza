/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemonstracaoAdminEntrar, { dynamic, generateMetadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
});

const abrir = async (vista?: string) => DemonstracaoAdminEntrar({ searchParams: Promise.resolve(vista ? { vista } : {}) });

describe('página /dev/admin-entrar', () => {
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
    await expect(abrir()).rejects.toThrow();
  });

  it('ligada: senha (padrão), código e cadastro com QR e chave', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const { unmount } = render(await abrir());
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar na administração' })).toBeTruthy();
    expect(screen.getByLabelText(/Senha/)).toBeTruthy();
    unmount();

    const codigo = render(await abrir('codigo'));
    expect(screen.getByRole('heading', { level: 1, name: 'Verificação em duas etapas' })).toBeTruthy();
    expect(screen.getByLabelText(/Código de 6 dígitos/)).toBeTruthy();
    codigo.unmount();

    render(await abrir('cadastro'));
    expect(screen.getByRole('img', { name: 'QR code para o aplicativo autenticador' })).toBeTruthy();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeTruthy();
  });
});
