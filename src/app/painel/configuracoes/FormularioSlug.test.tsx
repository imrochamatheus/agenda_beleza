/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';

import { estadoSlugInicial, lerFormularioSlug } from './estado';
import type { EstadoSlug } from './estado';
import { FormularioSlug } from './FormularioSlug';

// D-017 T-7: endereço atual e anteriores como texto (D-16), erro ligado ao campo, resumo e sucesso focados.

const semAcao = async (e: EstadoSlug) => e;
const campo = () => document.getElementById('config-slug') as HTMLInputElement;
const enviar = () => fireEvent.click(screen.getByRole('button', { name: 'Trocar endereço' }));

describe('FormularioSlug: estrutura', () => {
  it('endereço atual e anteriores como texto (sem links); campo rotulado com ajuda', () => {
    render(<FormularioSlug acao={semAcao} slugAtual="studio-bela" anteriores={['studio-antigo', 'outro-antigo']} />);
    expect(screen.getByText('/studio-bela').tagName).toBe('STRONG');
    expect(document.querySelectorAll('a')).toHaveLength(0);
    const lista = screen.getByRole('region', { name: 'Endereços anteriores' });
    expect(within(lista).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['/studio-antigo', '/outro-antigo']);
    const input = screen.getByRole('textbox', { name: 'Novo endereço' }) as HTMLInputElement;
    expect([input.name, input.value, input.maxLength, input.getAttribute('autocapitalize'), input.getAttribute('spellcheck')]).toEqual(['slug', '', 60, 'none', 'false']);
    expect(input.getAttribute('aria-describedby')).toBe('config-slug-ajuda');
    expect(document.getElementById('config-slug-ajuda')!.textContent).toBe(M.ajudaSlug);
    expect((screen.getByRole('button', { name: 'Trocar endereço' }) as HTMLButtonElement).form!.noValidate).toBe(true);
  });

  it('sem anteriores → texto "Nenhum endereço anterior."', () => {
    render(<FormularioSlug acao={semAcao} slugAtual="x" anteriores={[]} />);
    const lista = screen.getByRole('region', { name: 'Endereços anteriores' });
    expect(within(lista).queryByRole('list')).toBeNull();
    expect(within(lista).getByText(M.semAnteriores)).toBeTruthy();
  });
});

describe('FormularioSlug: envio', () => {
  it('erro: resumo focado com link ao campo; aria-invalid; valor preservado', async () => {
    const acao = vi.fn(async (_e: EstadoSlug, fd: FormData): Promise<EstadoSlug> => ({
      ...estadoSlugInicial(),
      valor: lerFormularioSlug(fd).valor,
      erros: { slug: M.slugReservado },
    }));
    render(<FormularioSlug acao={acao} slugAtual="studio-bela" anteriores={[]} />);
    fireEvent.change(campo(), { target: { value: 'painel' } });
    enviar();
    const resumo = await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(resumo));
    expect(within(resumo).getByRole('link').getAttribute('href')).toBe('#config-slug');
    expect(within(resumo).getByRole('link').textContent).toBe(`Novo endereço: ${M.slugReservado}`);
    expect(campo().getAttribute('aria-invalid')).toBe('true');
    expect(campo().getAttribute('aria-describedby')).toBe('config-slug-ajuda config-slug-erro');
    expect(document.getElementById('config-slug-erro')!.textContent).toContain(M.slugReservado);
    expect(campo().value).toBe('painel');
  });

  it('sucesso: mensagem focada e campo vazio; mensagem geral (acesso negado) em alerta', async () => {
    let chamada = 0;
    const acao = async (): Promise<EstadoSlug> => {
      chamada += 1;
      return chamada === 1 ? { ...estadoSlugInicial(), sucesso: M.slugTrocado } : { ...estadoSlugInicial(), mensagem: M.acessoNegado, valor: 'abc' };
    };
    render(<FormularioSlug acao={acao} slugAtual="studio-bela" anteriores={[]} />);
    fireEvent.change(campo(), { target: { value: 'bela-studio' } });
    enviar();
    expect((await screen.findByRole('status')).textContent).toContain(M.slugTrocado);
    const caixa = document.getElementById('config-slug-sucesso')!;
    await waitFor(() => expect(document.activeElement).toBe(caixa));
    expect(campo().value).toBe('');
    enviar();
    expect((await screen.findByRole('alert')).textContent).toContain(M.acessoNegado);
    expect(campo().value).toBe('abc');
  });
});
