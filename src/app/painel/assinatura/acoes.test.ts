import { beforeEach, describe, expect, it, vi } from 'vitest';

// Casca 'use server' (D-042): converte o resultado das ações em estado do formulário ou redirect. As
// ações de `defineAcao` são o limite do teste de unidade (o comportamento real é coberto na integração).

const mocks = vi.hoisted(() => ({
  iniciar: vi.fn(),
  regularizar: vi.fn(),
  cancelar: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/server/assinatura/assinatura.acao', () => ({
  iniciarAssinatura: mocks.iniciar,
  regularizarAssinatura: mocks.regularizar,
  cancelarAssinatura: mocks.cancelar,
}));

import { assinarAcao, cancelarAcao, regularizarAcao } from './acoes';

const anterior = { mensagem: null, variante: 'info' as const, em: 0 };
const ok = (dados: unknown) => ({ ok: true, dados });
const negado = { ok: false, erro: 'acesso_negado', status: 403 };
const anonimo = { ok: false, erro: 'nao_autenticado', status: 401 };

beforeEach(() => vi.clearAllMocks());

describe('assinarAcao', () => {
  it('iniciada redireciona ao checkout; teste iniciado é sucesso; provedor indisponível é erro; recusa é aviso', async () => {
    mocks.iniciar.mockResolvedValueOnce(ok({ resultado: 'iniciada', urlCheckout: 'https://mp.exemplo/checkout' }));
    await expect(assinarAcao(anterior)).rejects.toThrow('REDIRECT:https://mp.exemplo/checkout');
    mocks.iniciar.mockResolvedValueOnce(ok({ resultado: 'teste_iniciado' }));
    expect(await assinarAcao(anterior)).toMatchObject({ variante: 'sucesso' });
    mocks.iniciar.mockResolvedValueOnce(ok({ resultado: 'provedor_indisponivel' }));
    expect(await assinarAcao(anterior)).toMatchObject({ variante: 'erro', mensagem: expect.stringContaining('provedor de pagamento') });
    mocks.iniciar.mockResolvedValueOnce(ok({ resultado: 'recusado', motivo: 'ja_existe' }));
    expect(await assinarAcao(anterior)).toMatchObject({ variante: 'aviso' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/painel/assinatura');
  });

  it('sem sessão vai a /entrar?proximo=; sem permissão devolve aviso', async () => {
    mocks.iniciar.mockResolvedValueOnce(anonimo);
    await expect(assinarAcao(anterior)).rejects.toThrow('REDIRECT:/entrar?proximo=%2Fpainel%2Fassinatura');
    mocks.iniciar.mockResolvedValueOnce(negado);
    expect(await assinarAcao(anterior)).toMatchObject({ mensagem: 'Você não tem permissão para assinar.', variante: 'aviso' });
  });
});

describe('regularizarAcao', () => {
  it('iniciada redireciona à URL do provedor; as demais viram mensagem', async () => {
    mocks.regularizar.mockResolvedValueOnce(ok({ resultado: 'iniciada', url: 'https://mp.exemplo/atualizar' }));
    await expect(regularizarAcao(anterior)).rejects.toThrow('REDIRECT:https://mp.exemplo/atualizar');
    mocks.regularizar.mockResolvedValueOnce(ok({ resultado: 'provedor_indisponivel' }));
    expect(await regularizarAcao(anterior)).toMatchObject({ variante: 'erro', mensagem: expect.stringContaining('Nada foi alterado') });
    mocks.regularizar.mockResolvedValueOnce(ok({ resultado: 'recusado', motivo: 'estado' }));
    expect(await regularizarAcao(anterior)).toMatchObject({ variante: 'aviso' });
  });

  it('401 redireciona; 403 devolve aviso', async () => {
    mocks.regularizar.mockResolvedValueOnce(anonimo);
    await expect(regularizarAcao(anterior)).rejects.toThrow('REDIRECT:/entrar');
    mocks.regularizar.mockResolvedValueOnce(negado);
    expect(await regularizarAcao(anterior)).toMatchObject({ variante: 'aviso' });
  });
});

describe('cancelarAcao', () => {
  const form = (v?: string) => {
    const f = new FormData();
    if (v !== undefined) f.set('estadoVisto', v);
    return f;
  };

  it('repassa só o estadoVisto (texto) e converte o resultado em mensagem; revalida a página', async () => {
    mocks.cancelar.mockResolvedValueOnce(ok({ resultado: 'provedor_indisponivel' }));
    const r = await cancelarAcao(anterior, form('ativa'));
    expect(mocks.cancelar).toHaveBeenCalledWith({ estadoVisto: 'ativa' });
    expect(r).toMatchObject({ variante: 'erro', mensagem: 'Não foi possível concluir agora. Nada foi alterado; tente novamente.' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/painel/assinatura');
  });

  it('sem o campo envia undefined; arquivo no campo também', async () => {
    mocks.cancelar.mockResolvedValue(ok({ resultado: 'mudou' }));
    await cancelarAcao(anterior, form());
    expect(mocks.cancelar).toHaveBeenLastCalledWith({ estadoVisto: undefined });
    const f = new FormData();
    f.set('estadoVisto', new File(['x'], 'a.txt'));
    await cancelarAcao(anterior, f);
    expect(mocks.cancelar).toHaveBeenLastCalledWith({ estadoVisto: undefined });
  });

  it('401 redireciona; 403 devolve aviso', async () => {
    mocks.cancelar.mockResolvedValueOnce(anonimo);
    await expect(cancelarAcao(anterior, form())).rejects.toThrow('REDIRECT:/entrar');
    mocks.cancelar.mockResolvedValueOnce(negado);
    expect(await cancelarAcao(anterior, form())).toMatchObject({ mensagem: 'Você não tem permissão para cancelar a assinatura.', variante: 'aviso' });
  });
});
