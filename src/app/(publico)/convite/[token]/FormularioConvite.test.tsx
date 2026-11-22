/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ESTADO_INICIAL_CONVITE } from './estado';
import type { EstadoConvite } from './estado';
import { FormularioConvite } from './FormularioConvite';

// D-039 CA-15 (componente de /convite/[token]): formulário, recusa e sucesso; o estado da ação prevalece
// sobre o veredito da página (re-render do POST sem JS). A ação é substituída por uma função de teste.

const TOKEN = 'abc_DEF-123abc_DEF-123abc_DEF-123abc_DEF-12';
const RECUSA = 'Este convite é inválido, expirou ou já foi usado. Peça ao gestor do salão um novo convite.';
const SUCESSO = 'Senha definida. Entre com o seu e-mail.';
const semAcao = async (e: EstadoConvite) => e;

function renderizar(acao: (a: EstadoConvite, f: FormData) => Promise<EstadoConvite>, verificacao: 'valido' | 'recusado') {
  return render(<FormularioConvite acao={acao} token={TOKEN} verificacao={verificacao} mensagemRecusa={RECUSA} />);
}
const resposta = (e: Partial<EstadoConvite>) => async (): Promise<EstadoConvite> => ({
  status: 'formulario',
  mensagem: null,
  erroSenha: null,
  ...e,
});

describe('FormularioConvite', () => {
  it('válido: h1, campo "Senha" (password, new-password, ajuda ligada), token oculto, senha vazia, form noValidate', () => {
    const { container } = renderizar(semAcao, 'valido');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ativar o seu acesso');
    const senha = screen.getByLabelText('Senha') as HTMLInputElement;
    expect([senha.type, senha.autocomplete, senha.name, senha.value]).toEqual(['password', 'new-password', 'senha', '']);
    const ajuda = screen.getByText('Mínimo de 8 caracteres');
    expect(senha.getAttribute('aria-describedby')).toContain(ajuda.closest('[id]')!.id);
    const ocultos = [...container.querySelectorAll('input[type="hidden"]')].map((i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]);
    expect(ocultos).toEqual([['token', TOKEN]]);
    expect((screen.getByRole('button', { name: 'Definir senha' }) as HTMLButtonElement).type).toBe('submit');
    expect(senha.form!.noValidate).toBe(true);
    expect(container.textContent).not.toContain(TOKEN);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('recusado: h1 "Convite inválido", Alert de erro com a mensagem única, sem formulário nem token', () => {
    const { container } = renderizar(semAcao, 'recusado');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Convite inválido');
    expect(screen.getByRole('alert').textContent).toContain(RECUSA);
    expect(container.querySelector('form')).toBeNull();
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it('erro de validação: no campo (aria-invalid + aria-describedby), token preservado, senha vazia', async () => {
    const recebidos: Record<string, FormDataEntryValue | null>[] = [];
    const acao = vi.fn(async (_a: EstadoConvite, f: FormData): Promise<EstadoConvite> => {
      recebidos.push({ token: f.get('token'), senha: f.get('senha') });
      return { status: 'formulario', mensagem: null, erroSenha: 'A senha precisa ter pelo menos 8 caracteres.' };
    });
    const { container } = renderizar(acao, 'valido');
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'curta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Definir senha' }));
    const erro = await screen.findByText('A senha precisa ter pelo menos 8 caracteres.');
    const campo = screen.getByLabelText('Senha') as HTMLInputElement;
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(campo.getAttribute('aria-describedby')).toContain(erro.closest('p')!.id);
    expect(campo.value).toBe('');
    expect(recebidos).toEqual([{ token: TOKEN, senha: 'curta' }]);
    expect((container.querySelector('input[name="token"]') as HTMLInputElement).value).toBe(TOKEN);
  });

  it('falha inesperada: formulário de novo, com Alert de erro anunciado', async () => {
    renderizar(resposta({ mensagem: 'Não foi possível concluir. Tente de novo.' }), 'valido');
    fireEvent.click(screen.getByRole('button', { name: 'Definir senha' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível concluir.');
    expect(screen.getByLabelText('Senha')).toBeTruthy();
  });

  it('sucesso: h1 "Senha definida", Alert de status, link para /entrar, sem formulário', async () => {
    const { container } = renderizar(resposta({ status: 'sucesso', mensagem: SUCESSO }), 'valido');
    fireEvent.click(screen.getByRole('button', { name: 'Definir senha' }));
    expect((await screen.findByRole('status')).textContent).toContain(SUCESSO);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Senha definida');
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
    expect(container.querySelector('form')).toBeNull();
  });

  it('recusa vinda da ação (convite usado entre o GET e o POST): tela de recusa', async () => {
    renderizar(resposta({ status: 'recusado', mensagem: RECUSA }), 'valido');
    fireEvent.click(screen.getByRole('button', { name: 'Definir senha' }));
    expect((await screen.findByRole('alert')).textContent).toContain(RECUSA);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Convite inválido');
  });

  it('o estado da ação prevalece sobre a prop "recusado" (re-render do POST sem JS)', async () => {
    const acao = resposta({ status: 'sucesso', mensagem: SUCESSO });
    const { rerender } = renderizar(acao, 'valido');
    fireEvent.click(screen.getByRole('button', { name: 'Definir senha' }));
    await screen.findByRole('status');
    rerender(<FormularioConvite acao={acao} token={TOKEN} verificacao="recusado" mensagemRecusa={RECUSA} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Senha definida');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('estado inicial congelado, sem senha nem token; sem imports de servidor em tempo de execução; CSS só com tokens', () => {
    expect(ESTADO_INICIAL_CONVITE).toEqual({ status: 'inicial', mensagem: null, erroSenha: null });
    expect(Object.isFrozen(ESTADO_INICIAL_CONVITE)).toBe(true);
    for (const nome of ['./estado.ts', './FormularioConvite.tsx']) {
      const fonte = readFileSync(fileURLToPath(new URL(nome, import.meta.url)), 'utf8');
      expect(fonte, nome).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+['"]@\/server\//m);
    }
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'FormularioConvite.module.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
