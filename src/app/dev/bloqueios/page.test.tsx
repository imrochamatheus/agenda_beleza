/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';

import DemonstracaoBloqueios, { dynamic, generateMetadata } from './page';

// D-016 T-9: /dev/bloqueios só com a vitrine ligada; modos gestor, profissional e edição (D-24).

const M = MENSAGENS_BLOQUEIO;

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderizar(params: Record<string, string | string[]> = {}) {
  render(await DemonstracaoBloqueios({ searchParams: Promise.resolve(params) }));
}

describe('página /dev/bloqueios', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Bloqueios (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
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
    await expect(DemonstracaoBloqueios({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ modo: 'desconhecido' }], [{ modo: ['profissional', 'edicao'] }]])('gestor (padrão, %j): select de alvo e três bloqueios editáveis', async (params) => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar(params);
    expect(screen.getByRole('heading', { level: 1, name: 'Bloqueios' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Para quem' })).toBeTruthy();
    const itens = within(screen.getByRole('region', { name: 'Bloqueios vigentes e futuros' })).getAllByRole('listitem');
    expect(itens).toHaveLength(3);
    expect(itens.map((i) => i.querySelector('p')!.textContent)).toEqual(['Ana Demonstração', 'Bia Demonstração (inativo)', 'Salão inteiro']);
    expect(itens[2].textContent).toContain('(dia inteiro)');
    expect(screen.getAllByRole('button', { name: /^Remover bloqueio:/ })).toHaveLength(3);
    expect(screen.getAllByRole('link', { name: /^Editar bloqueio:/ })[0].getAttribute('href')).toBe('/dev/bloqueios?modo=edicao');
    const nav = screen.getByRole('navigation', { name: 'Navegação do painel', hidden: true });
    expect(nav.querySelector('[aria-current="page"]')!.textContent).toBe('Bloqueios');
  });

  it('profissional: sem select; o próprio editável e o do salão somente leitura; ?remocao=ok', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ modo: 'profissional', remocao: 'ok' });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText(M.propriaAgenda)).toBeTruthy();
    expect(screen.getByText(M.somenteLeitura)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Remover bloqueio:/ })).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toContain(M.removido);
  });

  it('edição: formulário preenchido com o bloqueio da Ana', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ modo: 'edicao' });
    expect(screen.getByRole('heading', { level: 1, name: 'Editar bloqueio' })).toBeTruthy();
    expect((document.getElementById('bloqueio-horaInicio') as HTMLInputElement).value).toBe('14:00');
    expect((document.getElementById('bloqueio-motivo') as HTMLInputElement).value).toBe('Dentista');
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeTruthy();
    expect(screen.getByText('Ana Demonstração')).toBeTruthy();
  });
});
