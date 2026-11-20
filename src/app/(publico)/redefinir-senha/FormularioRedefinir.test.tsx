/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ESTADO_INICIAL_REDEFINIR } from './estado';
import type { EstadoRedefinir } from './estado';
import { FormularioRedefinir } from './FormularioRedefinir';

// D-012 T-5: CA-19 (componente de /redefinir-senha: formulário, recusa e sucesso) e D-18 (o estado
// da ação prevalece sobre o veredito da página). A ação é substituída por uma função de teste.

const TOKEN = 'abc_DEF-123abc_DEF-123abc_DEF-123abc_DEF-12';
const RECUSA = 'Este link de redefinição é inválido, expirou ou já foi usado. Peça um novo link.';
const SUCESSO = 'Sua senha foi alterada. Entre com a nova senha.';
const semAcao = async (e: EstadoRedefinir) => e;

function renderizar(acao: (a: EstadoRedefinir, f: FormData) => Promise<EstadoRedefinir>, verificacao: 'valido' | 'recusado') {
  return render(<FormularioRedefinir acao={acao} token={TOKEN} verificacao={verificacao} mensagemRecusa={RECUSA} />);
}

const resposta = (e: Partial<EstadoRedefinir>) => async (): Promise<EstadoRedefinir> => ({
  status: 'formulario',
  mensagem: null,
  erroSenha: null,
  ...e,
});

describe('CA-19: FormularioRedefinir', () => {
  it('válido: h1, campo "Nova senha" (password, new-password, ajuda ligada), token oculto, senha vazia, <form noValidate>', () => {
    const { container } = renderizar(semAcao, 'valido');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Definir nova senha');
    const senha = screen.getByLabelText('Nova senha') as HTMLInputElement;
    expect([senha.type, senha.autocomplete, senha.name, senha.value]).toEqual(['password', 'new-password', 'senha', '']);
    const ajuda = screen.getByText('Mínimo de 8 caracteres');
    expect(senha.getAttribute('aria-describedby')).toContain(ajuda.closest('[id]')!.id);
    const ocultos = [...container.querySelectorAll('input[type="hidden"]')].map((i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]);
    expect(ocultos).toEqual([['token', TOKEN]]);
    const botao = screen.getByRole('button', { name: 'Salvar nova senha' }) as HTMLButtonElement;
    expect(botao.type).toBe('submit');
    expect(botao.form).toBe(senha.form);
    expect(senha.form!.noValidate).toBe(true);
    expect(senha.form!.getAttribute('method')).not.toBe('get');
    expect(container.textContent).not.toContain(TOKEN);
    expect(container.innerHTML).not.toMatch(new RegExp(`href="[^"]*${TOKEN}`));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('recusado: h1 "Link inválido", Alert de erro com a mensagem única, link para /recuperar-senha, sem formulário', () => {
    const { container } = renderizar(semAcao, 'recusado');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Link inválido');
    expect(screen.getByRole('alert').textContent).toContain(RECUSA);
    expect(screen.getByRole('link', { name: 'Pedir um novo link' }).getAttribute('href')).toBe('/recuperar-senha');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it('erro de validação: no campo (aria-invalid + aria-describedby), token oculto preservado, senha vazia', async () => {
    const recebidos: Record<string, FormDataEntryValue | null>[] = [];
    const acao = vi.fn(async (_a: EstadoRedefinir, f: FormData): Promise<EstadoRedefinir> => {
      recebidos.push({ token: f.get('token'), senha: f.get('senha') });
      return { status: 'formulario', mensagem: null, erroSenha: 'A senha precisa ter pelo menos 8 caracteres.' };
    });
    const { container } = renderizar(acao, 'valido');
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'curta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    const erro = await screen.findByText('A senha precisa ter pelo menos 8 caracteres.');
    const campo = screen.getByLabelText('Nova senha') as HTMLInputElement;
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(campo.getAttribute('aria-describedby')).toContain(erro.closest('p')!.id);
    expect(campo.value).toBe('');
    expect(recebidos).toEqual([{ token: TOKEN, senha: 'curta' }]);
    expect((container.querySelector('input[name="token"]') as HTMLInputElement).value).toBe(TOKEN);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha inesperada: formulário de novo, com Alert de erro anunciado', async () => {
    renderizar(resposta({ mensagem: 'Não foi possível redefinir a senha. Tente de novo.' }), 'valido');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível redefinir a senha.');
    expect(screen.getByLabelText('Nova senha')).toBeTruthy();
  });

  it('sucesso: h1 "Senha alterada", Alert de status, link para /entrar, sem formulário', async () => {
    const { container } = renderizar(resposta({ status: 'sucesso', mensagem: SUCESSO }), 'valido');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    expect((await screen.findByRole('status')).textContent).toContain(SUCESSO);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Senha alterada');
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
  });

  it('recusa vinda da ação (token usado entre o GET e o POST): tela de recusa', async () => {
    renderizar(resposta({ status: 'recusado', mensagem: RECUSA }), 'valido');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    expect((await screen.findByRole('alert')).textContent).toContain(RECUSA);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Link inválido');
  });

  it('D-18: prop "recusado" com estado "sucesso" (re-render do POST sem JS) → mostra o sucesso', async () => {
    // Simula o formState do POST sem JS: o componente renderizado de novo com verificacao=recusado
    // (o token já foi usado), mas o estado da ação é o sucesso.
    const acao = resposta({ status: 'sucesso', mensagem: SUCESSO });
    const { rerender } = renderizar(acao, 'valido');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    await screen.findByRole('status');
    rerender(<FormularioRedefinir acao={acao} token={TOKEN} verificacao="recusado" mensagemRecusa={RECUSA} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Senha alterada');
    expect(screen.getByRole('status').textContent).toContain(SUCESSO);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('estado inicial congelado, sem senha nem token', () => {
    expect(ESTADO_INICIAL_REDEFINIR).toEqual({ status: 'inicial', mensagem: null, erroSenha: null });
    expect(Object.isFrozen(ESTADO_INICIAL_REDEFINIR)).toBe(true);
    expect(Object.keys(ESTADO_INICIAL_REDEFINIR)).not.toContain('senha');
    expect(Object.keys(ESTADO_INICIAL_REDEFINIR)).not.toContain('token');
  });

  it('estado.ts e FormularioRedefinir.tsx não importam @/server em tempo de execução; CSS só com tokens', () => {
    for (const nome of ['./estado.ts', './FormularioRedefinir.tsx']) {
      const fonte = readFileSync(fileURLToPath(new URL(nome, import.meta.url)), 'utf8');
      expect(fonte, nome).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+['"]@\/server\//m);
    }
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'FormularioRedefinir.module.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
