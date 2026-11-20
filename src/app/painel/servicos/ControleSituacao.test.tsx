/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGENS_SERVICO } from '@/server/servicos/tipos';

import { ControleSituacao } from './ControleSituacao';
import type { EstadoSituacao } from './estado';

// D-014 T-5: CA-3/CA-14 no controle de situação: um formulário POST (sem diálogo, D-9), botão certo
// por situação, mensagem em role="status" (sucesso) ou role="alert" (erro).

const M = MENSAGENS_SERVICO;
const nunca = vi.fn(async (e: EstadoSituacao) => e);

describe('ControleSituacao', () => {
  it('ativo: botão "Desativar serviço" (submit) com id oculto; chama só a ação de desativar; sucesso em role="status"', async () => {
    const desativar = vi.fn(async (_e: EstadoSituacao, f: FormData): Promise<EstadoSituacao> => {
      expect(f.get('id')).toBe('s-1');
      return { variante: 'sucesso', mensagem: M.desativado };
    });
    render(<ControleSituacao id="s-1" ativo desativar={desativar} reativar={nunca} />);
    expect(screen.getByRole('heading', { name: 'Situação: ativo' })).toBeTruthy();
    const botao = screen.getByRole('button', { name: 'Desativar serviço' }) as HTMLButtonElement;
    expect(botao.type).toBe('submit');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(botao);
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(M.desativado);
    expect(desativar).toHaveBeenCalledTimes(1);
    expect(nunca).not.toHaveBeenCalled();
  });

  it('inativo: botão "Reativar serviço"; erro em role="alert"', async () => {
    const reativar = vi.fn(async (): Promise<EstadoSituacao> => ({ variante: 'erro', mensagem: M.acessoNegado }));
    render(<ControleSituacao id="s-2" ativo={false} desativar={nunca} reativar={reativar} />);
    expect(screen.getByRole('heading', { name: 'Situação: inativo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Desativar serviço' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reativar serviço' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain(M.acessoNegado);
    expect(reativar).toHaveBeenCalledTimes(1);
    expect(nunca).not.toHaveBeenCalled();
  });

  it('a mensagem sobrevive à troca de situação (revalidação da página): mesmo hook, novo botão', async () => {
    const desativar = vi.fn(async (): Promise<EstadoSituacao> => ({ variante: 'sucesso', mensagem: M.desativado }));
    const { rerender } = render(<ControleSituacao id="s-3" ativo desativar={desativar} reativar={nunca} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desativar serviço' }));
    await screen.findByRole('status');
    rerender(<ControleSituacao id="s-3" ativo={false} desativar={desativar} reativar={nunca} />);
    expect(screen.getByRole('status').textContent).toContain(M.desativado);
    expect(screen.getByRole('button', { name: 'Reativar serviço' })).toBeTruthy();
  });

  it('desativar → reativar → desativar: a mensagem é sempre a da última ação bem-sucedida', async () => {
    const desativar = vi.fn(async (): Promise<EstadoSituacao> => ({ variante: 'sucesso', mensagem: M.desativado }));
    const reativar = vi.fn(async (): Promise<EstadoSituacao> => ({ variante: 'sucesso', mensagem: M.reativado }));
    const { rerender } = render(<ControleSituacao id="s-4" ativo desativar={desativar} reativar={reativar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desativar serviço' }));
    await screen.findByText(M.desativado);
    rerender(<ControleSituacao id="s-4" ativo={false} desativar={desativar} reativar={reativar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reativar serviço' }));
    await screen.findByText(M.reativado);
    rerender(<ControleSituacao id="s-4" ativo desativar={desativar} reativar={reativar} />);
    expect(screen.getAllByRole('status').map((s) => s.textContent)).toEqual([expect.stringContaining(M.reativado)]);
    fireEvent.click(screen.getByRole('button', { name: 'Desativar serviço' }));
    rerender(<ControleSituacao id="s-4" ativo={false} desativar={desativar} reativar={reativar} />);
    await screen.findByText(M.desativado);
    expect(screen.queryByText(M.reativado)).toBeNull();
  });

  it('erro da ação atual tem prioridade sobre o sucesso anterior da outra', async () => {
    const desativar = vi.fn(async (): Promise<EstadoSituacao> => ({ variante: 'erro', mensagem: M.naoEncontrado }));
    const reativar = vi.fn(async (): Promise<EstadoSituacao> => ({ variante: 'sucesso', mensagem: M.reativado }));
    const { rerender } = render(<ControleSituacao id="s-5" ativo={false} desativar={desativar} reativar={reativar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reativar serviço' }));
    await screen.findByText(M.reativado);
    rerender(<ControleSituacao id="s-5" ativo desativar={desativar} reativar={reativar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desativar serviço' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain(M.naoEncontrado);
    expect(screen.queryByText(M.reativado)).toBeNull();
  });
});
