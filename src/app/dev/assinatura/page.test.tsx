/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { demonstrarAssinarAcao, demonstrarCancelarAcao, demonstrarRegularizarAcao } from './acoes';
import DemonstracaoAssinatura, { dynamic, generateMetadata } from './page';

// D-040/D-042: /dev/assinatura só com a vitrine ligada; os 9 estados, a etapa 2, o resultado e o histórico; ações sem provedor.

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
    [{}, 'Você ainda não assinou.'],
    [{ situacao: 'qualquer' }, 'Você ainda não assinou.'],
    [{ situacao: 'pendente' }, 'Assinatura pendente de autorização.'],
    [{ situacao: 'em_teste' }, 'Período de teste até 20/06/2027'],
    [{ situacao: 'ativa' }, 'Assinatura ativa.'],
    [{ situacao: 'em_carencia' }, 'Pagamento não confirmado.'],
    [{ situacao: 'suspensa' }, 'Assinatura suspensa por falta de pagamento.'],
    [{ situacao: 'cancelada' }, 'Assinatura cancelada.'],
    [{ situacao: 'encerrada' }, 'Assinatura encerrada.'],
    [{ situacao: 'manual' }, 'Salão suspenso pela administração.'],
  ])('situação %j mostra "%s" (data em 23:30 locais, não no dia seguinte do UTC)', async (params, frase) => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar(params);
    expect(screen.getByRole('heading', { level: 1, name: 'Assinatura' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: frase })).toBeTruthy();
  });

  it('?cancelar=1 abre a etapa 2 e os links preservam a situação e o histórico', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ situacao: 'ativa', cancelar: '1', historico: '12' });
    expect(screen.getByRole('heading', { level: 2, name: 'Cancelar assinatura?' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Manter assinatura' }).getAttribute('href')).toBe('/dev/assinatura?situacao=ativa&historico=12');
    expect(screen.getAllByRole('row')).toHaveLength(13);
  });

  it('a etapa 1 leva a ?cancelar=1 sem perder a situação', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ situacao: 'em_carencia' });
    expect(screen.getByRole('link', { name: 'Cancelar assinatura' }).getAttribute('href')).toBe('/dev/assinatura?situacao=em_carencia&cancelar=1');
  });

  it.each([
    ['cancelada', 'Sucesso:', 'Acesso até 20/06/2027'],
    ['encerrada', 'Sucesso:', 'somente leitura'],
    ['ja_cancelada', 'Informação:', 'já estava cancelada'],
    ['mudou', 'Informação:', 'A assinatura mudou'],
    ['erro', 'Erro de pagamento:', 'Nada foi alterado'],
  ])('?resultado=%s mostra %s e o texto', async (resultado, rotulo, texto) => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ situacao: 'ativa', resultado });
    const alerta = screen.getAllByRole(resultado === 'erro' ? 'alert' : 'status')[0];
    expect(alerta.textContent).toContain(rotulo);
    expect(alerta.textContent).toContain(texto);
  });

  it('histórico: 0 mostra o vazio; fora de 0..12 volta ao padrão do estado', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ situacao: 'ativa', historico: '0' });
    expect(screen.getByText('Nenhum pagamento registrado.')).toBeTruthy();
    document.body.innerHTML = '';
    await renderizar({ situacao: 'ativa', historico: '99' });
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('parâmetro repetido usa o primeiro valor', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    render(await DemonstracaoAssinatura({ searchParams: Promise.resolve({ situacao: ['ativa', 'manual'] }) }));
    expect(screen.getByRole('heading', { level: 2, name: 'Assinatura ativa.' })).toBeTruthy();
  });
});

describe('ações de demonstração', () => {
  const anterior = { mensagem: null, variante: 'info' as const, em: 0 };
  it('desligada: devolvem o estado anterior', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    for (const f of [demonstrarAssinarAcao, demonstrarRegularizarAcao, demonstrarCancelarAcao]) expect(await f(anterior)).toBe(anterior);
  });
  it('ligada: respondem "erro de pagamento" sem tocar em provedor', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    for (const f of [demonstrarAssinarAcao, demonstrarRegularizarAcao, demonstrarCancelarAcao]) {
      const r = await f(anterior);
      expect(r.variante).toBe('erro');
      expect(r.mensagem).not.toBeNull();
    }
  });
});
