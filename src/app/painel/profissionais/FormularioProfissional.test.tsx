/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGENS_PROFISSIONAL } from '@/server/profissionais/tipos';

import { ESTADO_INICIAL_FORMULARIO } from './estado';
import type { EstadoFormularioProfissional } from './estado';
import { FormularioProfissional } from './FormularioProfissional';

// D-013 T-5: CA-12, CA-13 e CA-16 no formulário de profissional. A ação é uma função de teste.

const M = MENSAGENS_PROFISSIONAL;
const semAcao = async (e: EstadoFormularioProfissional) => e;
const estado = (p: Partial<EstadoFormularioProfissional>): EstadoFormularioProfissional => ({ ...ESTADO_INICIAL_FORMULARIO, ...p });

describe('FormularioProfissional', () => {
  it('criar: campos rotulados, nome obrigatório, e-mail opcional com ajuda, sem id oculto', () => {
    render(<FormularioProfissional modo="criar" acao={semAcao} />);
    const nome = screen.getByLabelText(/^Nome/) as HTMLInputElement;
    const email = screen.getByLabelText('E-mail') as HTMLInputElement;
    expect([nome.name, nome.type, nome.required, nome.value, nome.maxLength]).toEqual(['nome', 'text', true, '', 100]);
    expect([email.name, email.type, email.required, email.readOnly, email.maxLength]).toEqual(['email', 'email', false, false, 254]);
    const ajuda = screen.getByText('Opcional. Usado para o convite de acesso ao painel.');
    expect(email.getAttribute('aria-describedby')).toContain(ajuda.id);
    const botao = screen.getByRole('button', { name: 'Cadastrar profissional' }) as HTMLButtonElement;
    expect(botao.type).toBe('submit');
    expect(botao.form!.noValidate).toBe(true);
    expect(document.querySelector('input[name="id"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Voltar para a lista' }).getAttribute('href')).toBe('/painel/profissionais');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('erros por campo: aria-invalid e aria-describedby ligados ao erro; valores preservados', async () => {
    const recebidos: Record<string, FormDataEntryValue | null>[] = [];
    const acao = vi.fn(async (_a: EstadoFormularioProfissional, f: FormData) => {
      recebidos.push({ nome: f.get('nome'), email: f.get('email'), id: f.get('id') });
      return estado({ erros: { nome: M.nome, email: M.email }, valores: { nome: 'A', email: 'ana@' } });
    });
    render(<FormularioProfissional modo="criar" acao={acao} />);
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar profissional' }));

    await screen.findByText(M.nome);
    expect(recebidos).toEqual([{ nome: 'A', email: 'ana@', id: null }]);
    for (const [rotulo, texto] of [
      [/^Nome/, M.nome],
      ['E-mail', M.email],
    ] as const) {
      const campo = screen.getByLabelText(rotulo);
      expect(campo.getAttribute('aria-invalid')).toBe('true');
      expect(campo.getAttribute('aria-describedby')).toContain(screen.getByText(texto).closest('p')!.id);
    }
    await waitFor(() => expect((screen.getByLabelText(/^Nome/) as HTMLInputElement).value).toBe('A'));
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('ana@');
  });

  it('erro geral e erro de formulário aparecem em Alert (role="alert")', async () => {
    const acao = async () => estado({ mensagem: M.acessoNegado, erros: { formulario: M.formulario } });
    render(<FormularioProfissional modo="criar" acao={acao} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar profissional' }));
    const alertas = await screen.findAllByRole('alert');
    expect(alertas.map((a) => a.textContent)).toEqual([expect.stringContaining(M.acessoNegado), expect.stringContaining(M.formulario)]);
  });

  it('editar sem vínculo: valores iniciais, id oculto, e-mail editável; botão "Salvar alterações"', async () => {
    const acao = vi.fn(async (e: EstadoFormularioProfissional, f: FormData) => {
      expect(f.get('id')).toBe('p-1');
      return e;
    });
    render(<FormularioProfissional modo="editar" acao={acao} profissional={{ id: 'p-1', nome: 'Ana', email: null, emailBloqueado: false }} />);
    expect((screen.getByLabelText(/^Nome/) as HTMLInputElement).value).toBe('Ana');
    const email = screen.getByLabelText('E-mail') as HTMLInputElement;
    expect([email.value, email.readOnly]).toEqual(['', false]);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1));
  });

  it('CA-13: editar com vínculo: e-mail somente leitura com o motivo ligado ao campo', () => {
    render(
      <FormularioProfissional
        modo="editar"
        acao={semAcao}
        profissional={{ id: 'p-2', nome: 'Bia', email: 'bia@exemplo.com', emailBloqueado: true }}
      />,
    );
    const email = screen.getByLabelText('E-mail') as HTMLInputElement;
    expect([email.value, email.readOnly]).toEqual(['bia@exemplo.com', true]);
    expect(email.getAttribute('aria-describedby')).toContain(screen.getByText(M.emailBloqueado).id);
    expect((document.querySelector('input[name="id"]') as HTMLInputElement).value).toBe('p-2');
  });

  it('estado.ts e o formulário não importam @/server em tempo de execução, exceto profissionais/tipos', () => {
    expect(ESTADO_INICIAL_FORMULARIO).toEqual({ mensagem: null, erros: {}, valores: { nome: '', email: '' } });
    expect(Object.isFrozen(ESTADO_INICIAL_FORMULARIO)).toBe(true);
    for (const nome of ['./estado.ts', './FormularioProfissional.tsx', './ListaProfissionais.tsx', './ControleAtivacao.tsx', './EuTambemAtendo.tsx']) {
      const fonte = readFileSync(fileURLToPath(new URL(nome, import.meta.url)), 'utf8');
      const runtime = [...fonte.matchAll(/^import\s+(?!type\b)[^;]*from\s+['"](@\/server\/[^'"]+)['"]/gm)].map((m) => m[1]);
      expect(runtime.filter((m) => m !== '@/server/profissionais/tipos'), nome).toEqual([]);
    }
  });
});
