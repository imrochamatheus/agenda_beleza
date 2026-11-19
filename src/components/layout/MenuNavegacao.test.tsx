/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NAVEGACAO_PAINEL } from '@/config/navegacao';

// usePathname real devolve null fora do App Router (sonda §0). O dublê permite simular a troca de
// rota que fecha o menu; o padrão continua null.
const rota = vi.hoisted(() => ({ atual: null as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => rota.atual }));

const { MenuNavegacao } = await import('./MenuNavegacao');

afterEach(() => {
  rota.atual = null;
});

function montar(caminhoAtual?: string) {
  const resultado = render(
    <>
      <MenuNavegacao itens={NAVEGACAO_PAINEL.gestor} rotulo="Navegação do painel" caminhoAtual={caminhoAtual} />
      <main tabIndex={-1}>conteúdo</main>
    </>,
  );
  const botao = screen.getByRole('button', { name: 'Menu' });
  const nav = document.querySelector('nav')!;
  return { ...resultado, botao, nav };
}

describe('MenuNavegacao (CA-3 em jsdom, CA-17, RN-13, RN-14)', () => {
  it('fechado: aria-expanded=false, aria-controls aponta para a nav, data-aberto=false', () => {
    const { botao, nav } = montar();
    expect(botao.getAttribute('type')).toBe('button');
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    expect(botao.getAttribute('aria-controls')).toBe(nav.id);
    expect(nav.getAttribute('aria-label')).toBe('Navegação do painel');
    expect(nav.getAttribute('data-aberto')).toBe('false');
    expect(document.querySelector('[aria-current]')).toBeNull();
  });

  it('abrir foca o 1º item; Esc fecha e devolve o foco ao botão', () => {
    const { botao, nav } = montar();
    botao.focus();
    fireEvent.click(botao);
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    expect(nav.getAttribute('data-aberto')).toBe('true');
    const links = nav.querySelectorAll('a');
    expect(links).toHaveLength(7);
    expect(document.activeElement).toBe(links[0]);

    expect(fireEvent.keyDown(links[0], { key: 'Escape' })).toBe(false);
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(botao);
  });

  it('acionar o botão de novo fecha; Esc com o menu fechado não faz nada', () => {
    const { botao, nav } = montar();
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(nav.getAttribute('data-aberto')).toBe('false');
    expect(fireEvent.keyDown(nav, { key: 'Escape' })).toBe(true);
  });

  it('outras teclas não fecham (não prende o foco: Tab segue)', () => {
    const { botao, nav } = montar();
    fireEvent.click(botao);
    expect(fireEvent.keyDown(nav.querySelector('a')!, { key: 'Tab' })).toBe(true);
    expect(nav.getAttribute('data-aberto')).toBe('true');
  });

  it('acionar um item fecha o menu', () => {
    const { botao, nav } = montar();
    fireEvent.click(botao);
    const link = nav.querySelectorAll('a')[2];
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);
    expect(nav.getAttribute('data-aberto')).toBe('false');
  });

  it('aria-current="page" com o caminhoAtual (um só item)', () => {
    montar('/painel/agenda/nova');
    const atuais = document.querySelectorAll('[aria-current="page"]');
    expect(atuais).toHaveLength(1);
    expect(atuais[0].textContent).toBe('Agenda');
  });

  it('sem caminhoAtual usa usePathname; mudança de rota fecha o menu', () => {
    rota.atual = '/painel/clientes';
    const { botao, nav, rerender } = montar();
    expect(document.querySelector('[aria-current="page"]')!.textContent).toBe('Clientes');
    fireEvent.click(botao);
    expect(nav.getAttribute('data-aberto')).toBe('true');
    rota.atual = '/painel/servicos';
    rerender(
      <>
        <MenuNavegacao itens={NAVEGACAO_PAINEL.gestor} rotulo="Navegação do painel" />
        <main tabIndex={-1}>conteúdo</main>
      </>,
    );
    expect(nav.getAttribute('data-aberto')).toBe('false');
    expect(document.querySelector('[aria-current="page"]')!.textContent).toBe('Serviços');
  });

  it('sem itens não renderiza nada; rótulo do botão configurável', () => {
    const { container } = render(<MenuNavegacao itens={[]} rotulo="X" />);
    expect(container.innerHTML).toBe('');
    render(<MenuNavegacao itens={NAVEGACAO_PAINEL.profissional} rotulo="Y" rotuloBotao="Abrir menu" />);
    expect(screen.getByRole('button', { name: 'Abrir menu' })).toBeTruthy();
  });
});
