/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGENS_CONVITE, SEM_CONVITE } from '@/server/convites/tipos';
import type { EstadoConviteVisao } from '@/server/convites/tipos';

import { ConviteProfissional, descreverConvite } from './ConviteProfissional';
import { ESTADO_INICIAL_CONVITE_PROFISSIONAL } from './estado';
import type { EstadoConviteProfissional } from './estado';

// D-039 CA-16: estado do convite, botão "Enviar"/"Reenviar", retorno anunciado, explicações sem botão.

const ID = '11111111-1111-4111-8111-111111111111';
const semAcao = async (e: EstadoConviteProfissional) => e;

function renderizar(p: Partial<Parameters<typeof ConviteProfissional>[0]> = {}) {
  return render(<ConviteProfissional id={ID} ativo email="ana@exemplo.com" convite={SEM_CONVITE} acao={semAcao} {...p} />);
}

describe('descreverConvite', () => {
  it.each<[EstadoConviteVisao, string]>([
    [SEM_CONVITE, 'Nenhum convite enviado.'],
    [{ estado: 'pendente', ate: '26/11/2026' }, 'Convite pendente, válido até 26/11/2026.'],
    [{ estado: 'expirado', ate: '10/11/2026' }, 'Convite expirado em 10/11/2026.'],
    [{ estado: 'aceito', ate: null }, 'Convite aceito.'],
  ])('%j → %s', (c, texto) => {
    expect(descreverConvite(c)).toBe(texto);
  });
});

describe('ConviteProfissional', () => {
  it('sem convite: "Enviar convite" (submit), id oculto, e-mail de destino e validade', () => {
    const { container } = renderizar();
    expect((screen.getByRole('button', { name: 'Enviar convite' }) as HTMLButtonElement).type).toBe('submit');
    expect((container.querySelector('input[name="id"]') as HTMLInputElement).value).toBe(ID);
    expect(screen.getByText(/ana@exemplo.com/)).toBeTruthy();
    expect(screen.getByText('Nenhum convite enviado.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pendente ou expirado: "Reenviar convite" e o estado escrito', () => {
    renderizar({ convite: { estado: 'pendente', ate: '26/11/2026' } });
    expect(screen.getByRole('button', { name: 'Reenviar convite' })).toBeTruthy();
    expect(screen.getByText('Convite pendente, válido até 26/11/2026.')).toBeTruthy();
  });

  it('inativo e sem e-mail: explicam o que falta e não têm botão nem id', () => {
    const { container, unmount } = renderizar({ ativo: false });
    expect(screen.getByText(MENSAGENS_CONVITE.inativo)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('input[name="id"]')).toBeNull();
    unmount();
    renderizar({ email: null });
    expect(screen.getByText(MENSAGENS_CONVITE.semEmail)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sucesso e aviso aparecem em região de status; erro, como alerta', async () => {
    const { unmount } = renderizar({ acao: async () => ({ variante: 'sucesso', mensagem: MENSAGENS_CONVITE.enviado }) });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }));
    expect((await screen.findByRole('status')).textContent).toContain(MENSAGENS_CONVITE.enviado);
    unmount();
    const aviso = renderizar({ acao: async () => ({ variante: 'aviso', mensagem: MENSAGENS_CONVITE.emailNaoEnviado }) });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }));
    expect((await screen.findByRole('status')).textContent).toContain(MENSAGENS_CONVITE.emailNaoEnviado);
    aviso.unmount();
    const acao = vi.fn(async (): Promise<EstadoConviteProfissional> => ({ variante: 'erro', mensagem: MENSAGENS_CONVITE.limite }));
    renderizar({ acao });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }));
    expect((await screen.findByRole('alert')).textContent).toContain(MENSAGENS_CONVITE.limite);
    expect(acao).toHaveBeenCalledTimes(1);
  });

  it('estado inicial congelado e vazio', () => {
    expect(ESTADO_INICIAL_CONVITE_PROFISSIONAL).toEqual({ variante: null, mensagem: null });
    expect(Object.isFrozen(ESTADO_INICIAL_CONVITE_PROFISSIONAL)).toBe(true);
  });
});
