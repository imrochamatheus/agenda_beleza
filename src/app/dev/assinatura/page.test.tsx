/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { demonstrarAssinarAcao } from './acoes';
import DemonstracaoAssinatura, { dynamic, generateMetadata } from './page';

// D-040: /dev/assinatura só com a vitrine ligada; "Assinar" só sem vigente ou pendente; ação sem provedor.

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderizar(params: Record<string, string> = {}) {
  render(await DemonstracaoAssinatura({ searchParams: Promise.resolve(params) }));
}

describe('página /dev/assinatura', () => {
  it('force-dynamic; metadados noindex só com a vitrine ligada', () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toEqual({ title: 'Assinatura (demonstração) · Agenda Beleza', robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
  });

  it('desligada → 404 sem ler os parâmetros', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const lidos = vi.fn();
    const searchParams = { then: () => lidos() } as unknown as Promise<Record<string, string>>;
    await expect(DemonstracaoAssinatura({ searchParams })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(lidos).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'Sem assinatura', true],
    [{ situacao: 'pendente' }, 'Assinatura pendente', true],
    [{ situacao: 'em_teste' }, 'Em período de teste', false],
    [{ situacao: 'qualquer' }, 'Sem assinatura', true],
  ])('situação %j mostra "%s" e o botão Assinar = %s', async (params, rotulo, botao) => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar(params);
    expect(screen.getByRole('heading', { level: 1, name: 'Assinatura' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(rotulo);
    expect(screen.queryByRole('button', { name: 'Assinar' }) !== null).toBe(botao);
    if (botao) expect(document.body.textContent).toMatch(/R\$.79,00 por mês, com 30 dias de teste/);
  });
});

describe('demonstrarAssinarAcao', () => {
  const anterior = { mensagem: null, sucesso: false };
  it('desligada: devolve o estado anterior', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(await demonstrarAssinarAcao(anterior)).toBe(anterior);
  });
  it('ligada: responde provedor indisponível, sem sucesso', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const r = await demonstrarAssinarAcao(anterior);
    expect(r.sucesso).toBe(false);
    expect(r.mensagem).toContain('provedor de pagamento');
  });
});
