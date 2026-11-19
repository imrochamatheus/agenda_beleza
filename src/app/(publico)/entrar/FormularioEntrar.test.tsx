/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ESTADO_INICIAL_ENTRAR } from './estado';
import type { EstadoEntrar } from './estado';
import { FormularioEntrar } from './FormularioEntrar';

// CA-18 (parte de componente, RN-20): rótulos, atributos, erro anunciado, e-mail preservado e
// senha vazia após erro. A ação é substituída por uma função assíncrona de teste.

const semAcao = async (e: EstadoEntrar) => e;

describe('CA-18: FormularioEntrar', () => {
  it('CA-18: rótulos associados, type/autocomplete/name e botão de envio', () => {
    render(<FormularioEntrar acao={semAcao} proximo={null} />);
    const email = screen.getByLabelText('E-mail') as HTMLInputElement;
    const senha = screen.getByLabelText('Senha') as HTMLInputElement;
    expect([email.type, email.autocomplete, email.name, email.value]).toEqual(['email', 'username', 'email', '']);
    expect([senha.type, senha.autocomplete, senha.name, senha.value]).toEqual([
      'password',
      'current-password',
      'senha',
      '',
    ]);
    const botao = screen.getByRole('button', { name: 'Entrar' }) as HTMLButtonElement;
    expect(botao.type).toBe('submit');
    expect(botao.form).toBe(email.form);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('CA-18: links "Esqueci minha senha" e "Criar conta do salão"', () => {
    render(<FormularioEntrar acao={semAcao} proximo={null} />);
    expect(screen.getByRole('link', { name: 'Esqueci minha senha' }).getAttribute('href')).toBe('/recuperar-senha');
    expect(screen.getByRole('link', { name: 'Criar conta do salão' }).getAttribute('href')).toBe('/cadastro');
  });

  it('campo oculto proximo só quando há valor', () => {
    const { container, unmount } = render(<FormularioEntrar acao={semAcao} proximo={null} />);
    expect(container.querySelector('input[name="proximo"]')).toBeNull();
    unmount();
    const outro = render(<FormularioEntrar acao={semAcao} proximo="/painel/agenda" />);
    const oculto = outro.container.querySelector('input[name="proximo"]') as HTMLInputElement;
    expect([oculto.type, oculto.value]).toEqual(['hidden', '/painel/agenda']);
  });

  it('CA-18: erro geral num Alert (role=alert), e-mail preservado e senha vazia', async () => {
    const recebidos: Record<string, FormDataEntryValue | null>[] = [];
    const acao = vi.fn(async (_anterior: EstadoEntrar, f: FormData): Promise<EstadoEntrar> => {
      recebidos.push({ email: f.get('email'), senha: f.get('senha'), proximo: f.get('proximo') });
      return { mensagem: 'E-mail ou senha incorretos.', erros: {}, email: 'gestora@exemplo.com' };
    });
    render(<FormularioEntrar acao={acao} proximo="/painel/agenda" />);
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'gestora@exemplo.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('E-mail ou senha incorretos.');
    expect(acao).toHaveBeenCalledTimes(1);
    expect(recebidos).toEqual([{ email: 'gestora@exemplo.com', senha: 'errada', proximo: '/painel/agenda' }]);
    await waitFor(() => expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('gestora@exemplo.com'));
    expect((screen.getByLabelText('Senha') as HTMLInputElement).value).toBe('');
  });

  it('erros por campo com aria-invalid, sem Alert', async () => {
    const acao = async (): Promise<EstadoEntrar> => ({
      mensagem: null,
      erros: { email: 'Informe seu e-mail.', senha: 'Informe sua senha.' },
      email: '',
    });
    render(<FormularioEntrar acao={acao} proximo={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByText('Informe seu e-mail.');
    expect(screen.getByText('Informe sua senha.')).toBeTruthy();
    expect(screen.getByLabelText('E-mail').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Senha').getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('estado inicial congelado e sem senha', () => {
    expect(ESTADO_INICIAL_ENTRAR).toEqual({ mensagem: null, erros: {}, email: '' });
    expect(Object.isFrozen(ESTADO_INICIAL_ENTRAR)).toBe(true);
    expect(Object.keys(ESTADO_INICIAL_ENTRAR)).not.toContain('senha');
  });

  it('estado.ts e FormularioEntrar.tsx não importam @/server em tempo de execução', () => {
    for (const nome of ['./estado.ts', './FormularioEntrar.tsx']) {
      const fonte = readFileSync(fileURLToPath(new URL(nome, import.meta.url)), 'utf8');
      expect(fonte, nome).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+['"]@\/server\//m);
    }
  });
});
