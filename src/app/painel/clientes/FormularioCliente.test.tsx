/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGENS_CLIENTE } from '@/server/clientes/tipos';

import { estadoInicial, lerFormularioCliente } from './estado';
import type { EstadoFormularioCliente } from './estado';
import { FormularioCliente } from './FormularioCliente';

// D-022 T-4 (CA-18): erro por campo ligado por aria-describedby, resumo focado e com links, valores
// preservados, sucesso focado, link da cliente que já usa o telefone.

const VALORES = { nome: 'Maria', telefone: '(11) 98765-4321' };
const semAcao = async (e: EstadoFormularioCliente) => e;
const nome = () => document.getElementById('cliente-nome') as HTMLInputElement;
const telefone = () => document.getElementById('cliente-telefone') as HTMLInputElement;
const enviar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

describe('FormularioCliente: estrutura', () => {
  it('campos rotulados com os valores iniciais; telefone tipo tel sem autocomplete; id oculto; sem validação nativa', () => {
    render(<FormularioCliente acao={semAcao} id="uuid-1" valoresIniciais={VALORES} />);
    const n = screen.getByRole('textbox', { name: 'Nome' }) as HTMLInputElement;
    const t = screen.getByLabelText('Telefone') as HTMLInputElement;
    expect([n.name, n.value, t.name, t.value, t.type, t.autocomplete, n.autocomplete]).toEqual(['nome', 'Maria', 'telefone', '(11) 98765-4321', 'tel', 'off', 'off']);
    const oculto = document.querySelector('input[name="id"]') as HTMLInputElement;
    expect([oculto.type, oculto.value]).toEqual(['hidden', 'uuid-1']);
    expect((screen.getByRole('button', { name: 'Salvar alterações' }) as HTMLButtonElement).form!.noValidate).toBe(true);
    expect(t.getAttribute('aria-describedby')).toContain('cliente-telefone');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('FormularioCliente: envio', () => {
  it('erros em dois campos: resumo focado lista os dois com link; aria-invalid e aria-describedby; valores preservados', async () => {
    const acao = vi.fn(async (_e: EstadoFormularioCliente, fd: FormData): Promise<EstadoFormularioCliente> => ({
      ...estadoInicial(lerFormularioCliente(fd).valores),
      erros: { telefone: MENSAGENS_CLIENTE.telefone, nome: MENSAGENS_CLIENTE.nomeTamanho },
    }));
    render(<FormularioCliente acao={acao} id="x" valoresIniciais={VALORES} />);
    fireEvent.change(nome(), { target: { value: 'A' } });
    fireEvent.change(telefone(), { target: { value: 'abc' } });
    enviar();
    const resumo = await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(resumo));
    expect(within(resumo).getByText(MENSAGENS_CLIENTE.resumoErros)).toBeTruthy();
    const links = within(resumo).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      [`Nome: ${MENSAGENS_CLIENTE.nomeTamanho}`, '#cliente-nome'],
      [`Telefone: ${MENSAGENS_CLIENTE.telefone}`, '#cliente-telefone'],
    ]);
    expect(nome().getAttribute('aria-invalid')).toBe('true');
    expect(telefone().getAttribute('aria-invalid')).toBe('true');
    expect(nome().getAttribute('aria-describedby')).toContain('cliente-nome-erro');
    expect(telefone().getAttribute('aria-describedby')).toContain('cliente-telefone-erro');
    expect(document.getElementById('cliente-telefone-erro')!.textContent).toContain(MENSAGENS_CLIENTE.telefone);
    expect([nome().value, telefone().value]).toEqual(['A', 'abc']);
    expect(acao).toHaveBeenCalledTimes(1);
  });

  it('telefone em uso: link para a cliente existente (e erro só no telefone)', async () => {
    const acao = async (): Promise<EstadoFormularioCliente> => ({
      ...estadoInicial(VALORES),
      erros: { telefone: MENSAGENS_CLIENTE.telefoneEmUso },
      existente: { id: 'u-9', nome: 'Yara' },
    });
    render(<FormularioCliente acao={acao} id="x" valoresIniciais={VALORES} hrefExistente="/c/u-9" />);
    enviar();
    const resumo = await screen.findByRole('alert');
    expect(within(resumo).getAllByRole('listitem')).toHaveLength(1);
    expect(within(resumo).getByRole('link', { name: 'Ver cadastro de Yara' }).getAttribute('href')).toBe('/c/u-9');
    expect(nome().getAttribute('aria-invalid')).toBeNull();
  });

  it('link padrão do cadastro existente usa a rota do painel', async () => {
    const acao = async (): Promise<EstadoFormularioCliente> => ({
      ...estadoInicial(VALORES),
      erros: { telefone: MENSAGENS_CLIENTE.telefoneEmUso },
      existente: { id: 'abc', nome: 'Zeca' },
    });
    render(<FormularioCliente acao={acao} id="x" valoresIniciais={VALORES} />);
    enviar();
    expect((await screen.findByRole('link', { name: 'Ver cadastro de Zeca' })).getAttribute('href')).toBe('/painel/clientes/abc');
  });

  it('sucesso: aviso focado e valores normalizados no formulário', async () => {
    const acao = async (): Promise<EstadoFormularioCliente> => ({ ...estadoInicial({ nome: 'Maria S.', telefone: '(11) 98765-4321' }), sucesso: MENSAGENS_CLIENTE.salva });
    render(<FormularioCliente acao={acao} id="x" valoresIniciais={VALORES} />);
    fireEvent.change(nome(), { target: { value: '  Maria   S. ' } });
    enviar();
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(MENSAGENS_CLIENTE.salva);
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('cliente-sucesso')));
    await waitFor(() => expect(nome().value).toBe('Maria S.'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('mensagem geral (acesso negado) aparece como alerta e preserva os valores', async () => {
    const acao = async (): Promise<EstadoFormularioCliente> => ({ ...estadoInicial({ nome: 'Digitado', telefone: '1' }), mensagem: MENSAGENS_CLIENTE.acessoNegado });
    render(<FormularioCliente acao={acao} id="x" valoresIniciais={VALORES} />);
    enviar();
    expect((await screen.findByRole('alert')).textContent).toContain(MENSAGENS_CLIENTE.acessoNegado);
    expect(nome().value).toBe('Digitado');
  });
});
