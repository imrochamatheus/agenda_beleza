/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ESTADO_INICIAL_REENVIO } from './estado';
import type { EstadoReenvio } from './estado';
import { FormularioReenvio } from './FormularioReenvio';

// D-011 T-6: CA-20 (componente de reenvio) e o reenvio por token do CA-5. A ação é substituída por
// uma função assíncrona de teste.

const semAcao = async (e: EstadoReenvio) => e;
const UNIFORME = 'Se houver um cadastro aguardando confirmação para este e-mail, enviamos um novo link.';

describe('CA-20: FormularioReenvio', () => {
  it('modo email: rótulo associado, type/autocomplete/name, botão de envio no mesmo form', () => {
    const { container } = render(<FormularioReenvio acao={semAcao} modo="email" />);
    const email = screen.getByLabelText('E-mail') as HTMLInputElement;
    expect([email.type, email.autocomplete, email.name, email.value]).toEqual(['email', 'email', 'email', '']);
    const botao = screen.getByRole('button', { name: 'Reenviar link de confirmação' }) as HTMLButtonElement;
    expect(botao.type).toBe('submit');
    expect(botao.form).toBe(email.form);
    expect(container.querySelector('input[type="hidden"]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('modo email-oculto: só o campo oculto com o e-mail; sem campo visível', () => {
    const { container } = render(<FormularioReenvio acao={semAcao} modo="email-oculto" email="a@exemplo.com" />);
    expect(screen.queryByLabelText('E-mail')).toBeNull();
    const ocultos = [...container.querySelectorAll('input')].map((i) => [i.type, i.name, i.value]);
    expect(ocultos).toEqual([['hidden', 'email', 'a@exemplo.com']]);
  });

  it('modo token: só o campo oculto com o token (enviado por POST, nunca em URL)', () => {
    const { container } = render(<FormularioReenvio acao={semAcao} modo="token" token="abc_DEF-123" />);
    expect(screen.queryByLabelText('E-mail')).toBeNull();
    const ocultos = [...container.querySelectorAll('input')].map((i) => [i.type, i.name, i.value]);
    expect(ocultos).toEqual([['hidden', 'token', 'abc_DEF-123']]);
    expect(container.querySelector('form')!.getAttribute('method')).not.toBe('get');
    expect(container.innerHTML).not.toMatch(/href="[^"]*abc_DEF-123/);
  });

  it('resposta uniforme num Alert de status; o campo mantém o e-mail', async () => {
    const recebidos: (FormDataEntryValue | null)[] = [];
    const acao = vi.fn(async (_a: EstadoReenvio, f: FormData): Promise<EstadoReenvio> => {
      recebidos.push(f.get('email'));
      return { mensagem: UNIFORME, variante: 'sucesso', erroEmail: null, email: 'ana@exemplo.com' };
    });
    render(<FormularioReenvio acao={acao} modo="email" />);
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@exemplo.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar link de confirmação' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(UNIFORME);
    expect(recebidos).toEqual(['ana@exemplo.com']);
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('ana@exemplo.com');
  });

  it('limite num Alert de erro (role=alert)', async () => {
    const acao = async (): Promise<EstadoReenvio> => ({
      mensagem: 'Muitas solicitações. Aguarde alguns minutos e tente de novo.',
      variante: 'erro',
      erroEmail: null,
      email: '',
    });
    render(<FormularioReenvio acao={acao} modo="token" token="t" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar link de confirmação' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Muitas solicitações');
  });

  it('erro de validação: no campo (aria-invalid + aria-describedby) no modo email; Alert nos modos ocultos', async () => {
    const acao = async (): Promise<EstadoReenvio> => ({
      mensagem: null,
      variante: null,
      erroEmail: 'Informe um e-mail válido.',
      email: 'x',
    });
    const um = render(<FormularioReenvio acao={acao} modo="email" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar link de confirmação' }));
    const erro = await screen.findByText('Informe um e-mail válido.');
    const campo = screen.getByLabelText('E-mail');
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(campo.getAttribute('aria-describedby')).toContain(erro.closest('p')!.id);
    expect(screen.queryByRole('alert')).toBeNull();
    um.unmount();

    render(<FormularioReenvio acao={acao} modo="email-oculto" email="x" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar link de confirmação' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Informe um e-mail válido.');
  });

  it('estado inicial congelado', () => {
    expect(ESTADO_INICIAL_REENVIO).toEqual({ mensagem: null, variante: null, erroEmail: null, email: '' });
    expect(Object.isFrozen(ESTADO_INICIAL_REENVIO)).toBe(true);
  });

  it('estado.ts e FormularioReenvio.tsx não importam @/server em tempo de execução', () => {
    for (const nome of ['./estado.ts', './FormularioReenvio.tsx']) {
      const fonte = readFileSync(fileURLToPath(new URL(nome, import.meta.url)), 'utf8');
      expect(fonte, nome).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+['"]@\/server\//m);
    }
  });
});
