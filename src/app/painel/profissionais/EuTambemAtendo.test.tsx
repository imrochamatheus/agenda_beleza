/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGENS_PROFISSIONAL } from '@/server/profissionais/tipos';

import { ESTADO_INICIAL_EU_TAMBEM_ATENDO } from './estado';
import type { EstadoEuTambemAtendo } from './estado';
import { EuTambemAtendo } from './EuTambemAtendo';

// D-013 T-5: CA-2/CA-16 ("eu também atendo"): botão de envio, aviso anunciado.

describe('EuTambemAtendo', () => {
  it('formulário com título e botão de envio; sem aviso no início', () => {
    render(<EuTambemAtendo acao={async (e) => e} />);
    expect(screen.getByRole('form', { name: 'Você também atende?' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Eu também atendo' }) as HTMLButtonElement).type).toBe('submit');
    expect(screen.queryByRole('status')).toBeNull();
    expect(ESTADO_INICIAL_EU_TAMBEM_ATENDO).toEqual({ variante: null, mensagem: null });
  });

  it('"já atende" aparece em região de status (role="status")', async () => {
    const acao = vi.fn(async (): Promise<EstadoEuTambemAtendo> => ({ variante: 'info', mensagem: MENSAGENS_PROFISSIONAL.jaAtende }));
    render(<EuTambemAtendo acao={acao} />);
    fireEvent.click(screen.getByRole('button', { name: 'Eu também atendo' }));
    expect((await screen.findByRole('status')).textContent).toContain('Você já atende neste salão.');
    expect(acao).toHaveBeenCalledTimes(1);
  });

  it('erro aparece como alerta (role="alert")', async () => {
    render(<EuTambemAtendo acao={async () => ({ variante: 'erro', mensagem: MENSAGENS_PROFISSIONAL.acessoNegado })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Eu também atendo' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso negado.');
  });
});
