/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { demonstrarReenvioAcao } from './acoes';
import { AUDITORIA_DEMONSTRACAO, MENSAGENS_DEMONSTRACAO, codigoDeDemonstracao, assinaturaDeDemonstracao, tentativasDeDemonstracao, idDaMensagem } from './demonstracao';
import Pagina, { dynamic, generateMetadata } from './page';

const redirecionar = vi.hoisted(() => vi.fn((d: string) => {
  throw new Error(`NEXT_REDIRECT ${d}`);
}));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), usePathname: () => '/dev/admin-mensagens', redirect: redirecionar }));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
const renderizar = async (p: Record<string, string> = {}) => render(await Pagina({ searchParams: Promise.resolve(p) }));

describe('/dev/admin-mensagens (D-045)', () => {
  it('force-dynamic; metadados só com a vitrine; desligada → 404', async () => {
    expect(dynamic).toBe('force-dynamic');
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    expect(generateMetadata()).toMatchObject({ robots: { index: false, follow: false } });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(generateMetadata()).toEqual({});
    await expect(renderizar()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('fila: 20 de 47, filtros por estado/tipo/salão, confirmação, tentativas, 404 de id desconhecido', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar();
    expect(screen.getByText('20 de 47 mensagens')).toBeTruthy();
    cleanup();
    await renderizar({ estado: 'falhou' });
    const falhas = MENSAGENS_DEMONSTRACAO.filter((m) => m.estado === 'falhou').length;
    expect(screen.getAllByRole('link', { name: 'Reenviar' })).toHaveLength(Math.min(20, falhas));
    cleanup();
    await renderizar({ confirmar: idDaMensagem(2), reenvio: 'ok' });
    expect(screen.getByRole('button', { name: 'Confirmar reenvio' })).toBeTruthy();
    cleanup();
    await renderizar({ confirmar: idDaMensagem(1) });
    expect(screen.getByText('Esta mensagem não está mais com falha.')).toBeTruthy();
    cleanup();
    await renderizar({ detalhe: idDaMensagem(4) });
    expect(screen.getByRole('table', { name: 'Tentativas' })).toBeTruthy();
    await expect(renderizar({ detalhe: 'nao-existe' })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('auditoria: filtros em memória; assinatura: vistas cheia, vazia e com mais eventos', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await renderizar({ vista: 'auditoria' });
    expect(screen.getByText(`20 de ${AUDITORIA_DEMONSTRACAO.length} registros`)).toBeTruthy();
    cleanup();
    await renderizar({ vista: 'auditoria', acao: 'mensagem.reenviar', resultado: 'sucesso', ator: 'admin@plataforma.com.br', salao: '22222222-2222-4222-8222-222222222222', de: '2026-11-01', ate: '2026-12-01' });
    expect(screen.getByText(/registros? · Ação:/)).toBeTruthy();
    cleanup();
    await renderizar({ vista: 'assinatura' });
    expect(screen.getByRole('heading', { level: 1, name: /Assinatura de/ })).toBeTruthy();
    cleanup();
    await renderizar({ vista: 'assinatura-vazia' });
    expect(screen.getByRole('heading', { name: 'Este salão ainda não tem assinatura' })).toBeTruthy();
    cleanup();
    await renderizar({ vista: 'assinatura-mais' });
    expect(screen.getByText('Mostrando os 50 mais recentes')).toBeTruthy();
  });

  it('dados: nenhum telefone completo; códigos fixos por mensagem; tentativas por estado', () => {
    expect(JSON.stringify(MENSAGENS_DEMONSTRACAO)).not.toMatch(/\+55\d{10}/);
    expect(codigoDeDemonstracao('xx')).toBe('inexistente');
    expect(codigoDeDemonstracao(idDaMensagem(1))).toBe('recusada');
    const codigos = new Set(MENSAGENS_DEMONSTRACAO.filter((m) => m.estado === 'falhou').map((m) => codigoDeDemonstracao(m.id)));
    expect(codigos).toEqual(new Set(['ok', 'ok_fila', 'obsoleta', 'anonimizada']));
    expect(tentativasDeDemonstracao(idDaMensagem(1)).map((t) => t.resultado)).toEqual(['falha', 'sucesso']);
    expect(tentativasDeDemonstracao('x')).toEqual([]);
    expect(MENSAGENS_DEMONSTRACAO.filter((m) => m.estado === 'nao_enviada').every((m) => tentativasDeDemonstracao(m.id).length === 0)).toBe(true);
    expect(MENSAGENS_DEMONSTRACAO.find((m) => m.estado === 'pendente') && tentativasDeDemonstracao(MENSAGENS_DEMONSTRACAO.find((m) => m.estado === 'pendente')!.id)[0].resultado).toBeNull();
    expect(assinaturaDeDemonstracao('assinatura-vazia')?.assinatura).toBeNull();
  });
});

describe('demonstrarReenvioAcao', () => {
  const form = (c: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(c)) f.set(k, v);
    return f;
  };
  it('desligada: não faz nada; ligada: PRG com o código fixo e os filtros validados', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    await demonstrarReenvioAcao(form({ mensagemId: idDaMensagem(2) }));
    expect(redirecionar).not.toHaveBeenCalled();
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await expect(demonstrarReenvioAcao(form({ mensagemId: idDaMensagem(2), estado: 'falhou', tipo: 'xx', pagina: '2' }))).rejects.toThrow(
      `NEXT_REDIRECT /dev/admin-mensagens?estado=falhou&pagina=2&reenvio=${codigoDeDemonstracao(idDaMensagem(2))}`,
    );
    await expect(demonstrarReenvioAcao(form({}))).rejects.toThrow('reenvio=inexistente');
  });
});
