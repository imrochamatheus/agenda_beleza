/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CAMPOS_CONSENTIMENTO, MENSAGENS_CONSENTIMENTO } from '@/server/consentimento/tipos';

import { CaixasConsentimento } from './CaixasConsentimento';

describe('CaixasConsentimento (CA-5, CA-18)', () => {
  it('mostra as duas caixas na ordem: obrigatória e convite desmarcado', () => {
    render(<CaixasConsentimento />);
    const caixas = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(caixas.map((c) => c.name)).toEqual([CAMPOS_CONSENTIMENTO.mensagensReserva, CAMPOS_CONSENTIMENTO.conviteAvaliacao]);
    expect(caixas[0].required).toBe(true);
    expect(caixas[1].required).toBe(false);
    expect(caixas.map((c) => c.checked)).toEqual([false, false]);
  });

  it('os links dos Termos e da Privacidade abrem em nova aba com rel noopener e aviso', () => {
    render(<CaixasConsentimento />);
    const termos = screen.getAllByRole('link', { name: /Termos de Uso/ })[0];
    expect(termos.getAttribute('href')).toBe('/termos');
    expect(termos.getAttribute('target')).toBe('_blank');
    expect(termos.getAttribute('rel')).toBe('noopener');
    expect(termos.textContent).toContain('(abre em nova aba)');
    const privacidade = screen.getAllByRole('link', { name: /Política de Privacidade/ })[0];
    expect(privacidade.getAttribute('href')).toBe('/privacidade');
    // A caixa do convite também liga à Privacidade.
    expect(screen.getAllByRole('link', { name: /Política de Privacidade/ })).toHaveLength(2);
  });

  it('o rótulo inteiro é clicável: o nome acessível da caixa vem do texto da finalidade', () => {
    render(<CaixasConsentimento />);
    expect(screen.getByRole('checkbox', { name: /WhatsApp as mensagens da minha reserva/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /convite por WhatsApp para avaliar/ })).toBeTruthy();
  });

  it('o erro fica associado à caixa obrigatória', () => {
    render(<CaixasConsentimento erros={{ mensagensReserva: MENSAGENS_CONSENTIMENTO.mensagensReserva }} />);
    const caixa = screen.getAllByRole('checkbox')[0];
    expect(caixa.getAttribute('aria-invalid')).toBe('true');
    const ids = (caixa.getAttribute('aria-describedby') ?? '').split(' ');
    const mensagem = ids.map((i) => document.getElementById(i)).find((e) => e?.textContent?.includes(MENSAGENS_CONSENTIMENTO.mensagensReserva));
    expect(mensagem).toBeTruthy();
  });

  it('preserva o estado marcado ao reexibir; o convite só vem marcado se estava', () => {
    const { unmount } = render(<CaixasConsentimento valores={{ conviteAvaliacao: true }} />);
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).map((c) => c.checked)).toEqual([false, true]);
    unmount();
    render(<CaixasConsentimento valores={{ mensagensReserva: true, conviteAvaliacao: false }} />);
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).map((c) => c.checked)).toEqual([true, false]);
  });

  it('idPrefixo diferencia os ids', () => {
    render(<CaixasConsentimento idPrefixo="x" />);
    expect(document.getElementById('x-mensagens')).not.toBeNull();
    expect(document.getElementById('x-convite')).not.toBeNull();
  });
});
