/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ESTADO_INICIAL_CADASTRO } from './estado';
import type { EstadoCadastro } from './estado';
import { FormularioCadastro } from './FormularioCadastro';

// D-011 T-6: CA-20 (componente de /cadastro): rótulos, atributos, erros associados, Alert anunciado,
// valores preservados, senha nunca devolvida e o painel de sucesso. A ação é uma função de teste.

const semAcao = async (e: EstadoCadastro) => e;

function estado(parcial: Partial<EstadoCadastro>): EstadoCadastro {
  return { ...ESTADO_INICIAL_CADASTRO, ...parcial };
}

describe('CA-20: FormularioCadastro', () => {
  it('quatro campos rotulados com type/autocomplete/name, ajuda da senha e botão de envio', () => {
    render(<FormularioCadastro acao={semAcao} />);
    const campos = ['Seu nome', 'E-mail', 'Senha', 'Nome do salão'].map((r) => screen.getByLabelText(r) as HTMLInputElement);
    expect(campos.map((c) => [c.type, c.autocomplete, c.name, c.value])).toEqual([
      ['text', 'name', 'nome', ''],
      ['email', 'email', 'email', ''],
      ['password', 'new-password', 'senha', ''],
      ['text', 'organization', 'nomeSalao', ''],
    ]);
    const ajuda = screen.getByText('Mínimo de 8 caracteres');
    expect(campos[2].getAttribute('aria-describedby')).toContain(ajuda.id);
    const botao = screen.getByRole('button', { name: 'Criar conta' }) as HTMLButtonElement;
    expect(botao.type).toBe('submit');
    expect(campos.every((c) => c.form === botao.form)).toBe(true);
    expect(botao.form!.noValidate).toBe(true);
    expect(screen.getByRole('link', { name: 'Já tenho conta' }).getAttribute('href')).toBe('/entrar');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('envia os quatro campos; erros por campo com aria-invalid e aria-describedby; valores preservados; senha vazia', async () => {
    const recebidos: Record<string, FormDataEntryValue | null>[] = [];
    const acao = vi.fn(async (_a: EstadoCadastro, f: FormData): Promise<EstadoCadastro> => {
      recebidos.push(Object.fromEntries(['nome', 'email', 'senha', 'nomeSalao'].map((k) => [k, f.get(k)])));
      return estado({
        erros: {
          nome: 'Informe seu nome (de 2 a 100 caracteres).',
          senha: 'A senha precisa ter pelo menos 8 caracteres.',
          nomeSalao: 'Informe o nome do salão (de 2 a 80 caracteres).',
        },
        valores: { nome: 'A', email: 'ana@exemplo.com', nomeSalao: ' ' },
      });
    });
    render(<FormularioCadastro acao={acao} />);
    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@exemplo.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'curta' } });
    fireEvent.change(screen.getByLabelText('Nome do salão'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));

    await screen.findByText('Informe seu nome (de 2 a 100 caracteres).');
    expect(recebidos).toEqual([{ nome: 'A', email: 'ana@exemplo.com', senha: 'curta', nomeSalao: ' ' }]);
    for (const [rotulo, invalido] of [
      ['Seu nome', true],
      ['E-mail', false],
      ['Senha', true],
      ['Nome do salão', true],
    ] as const) {
      const campo = screen.getByLabelText(rotulo);
      expect(campo.getAttribute('aria-invalid'), rotulo).toBe(invalido ? 'true' : null);
    }
    const erroNome = screen.getByText('Informe seu nome (de 2 a 100 caracteres).').closest('p')!;
    expect(screen.getByLabelText('Seu nome').getAttribute('aria-describedby')).toContain(erroNome.id);
    await waitFor(() => expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('ana@exemplo.com'));
    expect((screen.getByLabelText('Seu nome') as HTMLInputElement).value).toBe('A');
    expect((screen.getByLabelText('Senha') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('e-mail já cadastrado: Alert (role=alert) com links para entrar e para o reenvio; erro no campo e-mail', async () => {
    const msg = 'Este e-mail já está cadastrado. Entre ou, se ainda não confirmou o e-mail, peça um novo link.';
    const acao = async (): Promise<EstadoCadastro> =>
      estado({ mensagem: msg, emailExistente: true, erros: { email: msg }, valores: { nome: 'Ana', email: 'ana@exemplo.com', nomeSalao: 'X' } });
    render(<FormularioCadastro acao={acao} />);
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain(msg);
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
    expect(screen.getByRole('link', { name: 'Pedir um novo link de confirmação' }).getAttribute('href')).toBe(
      '/confirmar-email',
    );
    expect(screen.getByLabelText('E-mail').getAttribute('aria-invalid')).toBe('true');
  });

  it('falha genérica: Alert sem os links do e-mail existente', async () => {
    const acao = async (): Promise<EstadoCadastro> => estado({ mensagem: 'Não foi possível concluir o cadastro. Tente de novo.' });
    render(<FormularioCadastro acao={acao} />);
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível concluir o cadastro.');
    expect(screen.queryByRole('link', { name: 'Pedir um novo link de confirmação' })).toBeNull();
  });

  it('sucesso: troca o formulário por "Verifique seu e-mail" com o e-mail, 24 horas e o link de reenvio', async () => {
    const acao = async (): Promise<EstadoCadastro> =>
      estado({ status: 'sucesso', valores: { nome: 'Ana', email: 'ana@exemplo.com', nomeSalao: 'Studio Bela' } });
    render(<FormularioCadastro acao={acao} />);
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    const titulo = await screen.findByRole('heading', { level: 2, name: 'Verifique seu e-mail' });
    expect(titulo).toBeTruthy();
    expect(document.body.textContent).toContain('ana@exemplo.com');
    expect(document.body.textContent).toContain('24 horas');
    expect(screen.queryByLabelText('Senha')).toBeNull();
    expect(document.querySelector('form')).toBeNull();
    expect(screen.getByRole('link', { name: 'Reenviar link' }).getAttribute('href')).toBe('/confirmar-email');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('sucesso com falha de envio: aviso anunciado (role=status)', async () => {
    const aviso = "Não conseguimos enviar o e-mail agora. Use 'Reenviar link' em alguns minutos.";
    const acao = async (): Promise<EstadoCadastro> =>
      estado({ status: 'sucesso', avisoEnvio: aviso, valores: { nome: 'Ana', email: 'ana@exemplo.com', nomeSalao: 'S' } });
    render(<FormularioCadastro acao={acao} />);
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect((await screen.findByRole('status')).textContent).toContain(aviso);
  });

  it('estado inicial congelado e sem senha', () => {
    expect(ESTADO_INICIAL_CADASTRO).toEqual({
      status: 'editando',
      mensagem: null,
      emailExistente: false,
      erros: {},
      valores: { nome: '', email: '', nomeSalao: '' },
      avisoEnvio: null,
    });
    expect(Object.isFrozen(ESTADO_INICIAL_CADASTRO)).toBe(true);
    expect(JSON.stringify(ESTADO_INICIAL_CADASTRO)).not.toContain('senha');
  });

  it('estado.ts e FormularioCadastro.tsx não importam @/server em tempo de execução', () => {
    for (const nome of ['./estado.ts', './FormularioCadastro.tsx']) {
      const fonte = readFileSync(fileURLToPath(new URL(nome, import.meta.url)), 'utf8');
      expect(fonte, nome).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+['"]@\/server\//m);
    }
  });
});
