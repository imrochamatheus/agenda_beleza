/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ESTADO_INICIAL_RECUPERAR } from './estado';
import type { EstadoRecuperar } from './estado';
import { FormularioRecuperar } from './FormularioRecuperar';

// D-012 T-5: CA-19 (componente de /recuperar-senha). A ação é substituída por uma função
// assíncrona de teste.

const semAcao = async (e: EstadoRecuperar) => e;
const UNIFORME = 'Se houver uma conta com este e-mail, enviamos um link para redefinir a senha. Ele vale por 1 hora.';

describe('CA-19: FormularioRecuperar', () => {
  it('rótulo associado, type/autocomplete/name, botão de envio no mesmo form e link para /entrar', () => {
    const { container } = render(<FormularioRecuperar acao={semAcao} />);
    const email = screen.getByLabelText('E-mail') as HTMLInputElement;
    expect([email.type, email.autocomplete, email.name, email.value]).toEqual(['email', 'email', 'email', '']);
    const botao = screen.getByRole('button', { name: 'Enviar link' }) as HTMLButtonElement;
    expect(botao.type).toBe('submit');
    expect(botao.form).toBe(email.form);
    expect(email.form!.noValidate).toBe(true);
    expect(screen.getByRole('link', { name: 'Voltar para entrar' }).getAttribute('href')).toBe('/entrar');
    expect(container.querySelector('input[type="hidden"]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('resposta uniforme num Alert de status; o campo mantém o e-mail', async () => {
    const recebidos: (FormDataEntryValue | null)[] = [];
    const acao = vi.fn(async (_a: EstadoRecuperar, f: FormData): Promise<EstadoRecuperar> => {
      recebidos.push(f.get('email'));
      return { mensagem: UNIFORME, variante: 'sucesso', erroEmail: null, email: 'ana@exemplo.com' };
    });
    render(<FormularioRecuperar acao={acao} />);
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@exemplo.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(UNIFORME);
    expect(recebidos).toEqual(['ana@exemplo.com']);
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('ana@exemplo.com');
  });

  it('limite num Alert de erro (role=alert)', async () => {
    const acao = async (): Promise<EstadoRecuperar> => ({
      mensagem: 'Muitas solicitações. Aguarde alguns minutos e tente de novo.',
      variante: 'erro',
      erroEmail: null,
      email: 'ana@exemplo.com',
    });
    render(<FormularioRecuperar acao={acao} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Muitas solicitações');
  });

  it('erro de validação no campo (aria-invalid + aria-describedby), sem Alert', async () => {
    const acao = async (): Promise<EstadoRecuperar> => ({
      mensagem: null,
      variante: null,
      erroEmail: 'Informe um e-mail válido.',
      email: 'x',
    });
    render(<FormularioRecuperar acao={acao} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
    const erro = await screen.findByText('Informe um e-mail válido.');
    const campo = screen.getByLabelText('E-mail');
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(campo.getAttribute('aria-describedby')).toContain(erro.closest('p')!.id);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('estado inicial congelado', () => {
    expect(ESTADO_INICIAL_RECUPERAR).toEqual({ mensagem: null, variante: null, erroEmail: null, email: '' });
    expect(Object.isFrozen(ESTADO_INICIAL_RECUPERAR)).toBe(true);
  });

  it('estado.ts e FormularioRecuperar.tsx não importam @/server em tempo de execução; CSS só com tokens', () => {
    for (const nome of ['./estado.ts', './FormularioRecuperar.tsx']) {
      const fonte = readFileSync(fileURLToPath(new URL(nome, import.meta.url)), 'utf8');
      expect(fonte, nome).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+['"]@\/server\//m);
    }
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'FormularioRecuperar.module.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
