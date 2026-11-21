/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AdminLayout } from './AdminLayout';
import { ID_CONTEUDO } from './Estrutura';
import { PanelLayout } from './PanelLayout';
import { PublicLayout } from './PublicLayout';

const focaveis = (raiz: HTMLElement) =>
  [...raiz.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].filter(
    (e) => e.tabIndex >= 0,
  );

function conferirEstrutura(container: HTMLElement) {
  const pular = focaveis(container)[0];
  expect(pular.tagName).toBe('A');
  expect(pular.textContent).toBe('Pular para o conteúdo');
  expect(pular.getAttribute('href')).toBe(`#${ID_CONTEUDO}`);
  expect(screen.getAllByRole('main')).toHaveLength(1);
  const main = screen.getByRole('main');
  expect(main.id).toBe(ID_CONTEUDO);
  expect(main.getAttribute('tabindex')).toBe('-1');
  expect(within(screen.getByRole('banner')).getByText('Agenda Beleza')).toBeTruthy();
  for (const nav of screen.getAllByRole('navigation', { hidden: true })) {
    expect(nav.getAttribute('aria-label')).toBeTruthy();
  }
  expect([...container.querySelectorAll('[tabindex]')].every((e) => Number(e.getAttribute('tabindex')) <= 0)).toBe(
    true,
  );
}

describe('PublicLayout (CA-17, RN-12)', () => {
  it('plataforma: marca com link para o início, Entrar, Criar conta, rodapé legal', () => {
    const { container } = render(
      <PublicLayout>
        <h1>Conteúdo</h1>
      </PublicLayout>,
    );
    conferirEstrutura(container);
    expect(screen.getByRole('link', { name: 'Agenda Beleza' }).getAttribute('href')).toBe('/');
    const acesso = screen.getByRole('navigation', { name: 'Acesso' });
    expect(within(acesso).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Entrar', '/entrar'],
      ['Criar conta', '/cadastro'],
    ]);
    const rodape = screen.getByRole('contentinfo');
    const legal = within(rodape).getByRole('navigation', { name: 'Informações legais' });
    expect(within(legal).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Termos de Uso', '/termos'],
      ['Política de Privacidade', '/privacidade'],
    ]);
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Conteúdo' })).toBeTruthy();
    // Sem menu móvel no público.
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
  });

  it('variante explícita plataforma equivale ao padrão', () => {
    render(<PublicLayout variante="plataforma">x</PublicLayout>);
    expect(screen.getByRole('navigation', { name: 'Acesso' })).toBeTruthy();
  });

  it('salão: nome do salão, sem Entrar/Criar conta, com Termos e Privacidade', () => {
    const { container } = render(
      <PublicLayout variante="salao" nomeSalao="Salão Exemplo">
        x
      </PublicLayout>,
    );
    conferirEstrutura(container);
    expect(within(screen.getByRole('banner')).getByText('Salão Exemplo')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Entrar' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Criar conta' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Acesso' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Termos de Uso' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Política de Privacidade' })).toBeTruthy();
  });
});

const hrefsDoPainel = () =>
  within(screen.getByRole('navigation', { name: 'Navegação do painel', hidden: true }))
    .getAllByRole('link', { hidden: true })
    .map((a) => a.getAttribute('href'));

describe('PanelLayout (CA-17, CA-11, RN-12, RN-16)', () => {
  it('gestor: marcos, nome do salão, área do usuário, 7 itens e sem rodapé', () => {
    const { container } = render(
      <PanelLayout papel="gestor" nomeSalao="Salão Exemplo" areaUsuario={<button type="button">Sair</button>}>
        x
      </PanelLayout>,
    );
    conferirEstrutura(container);
    expect(within(screen.getByRole('banner')).getByText('Salão Exemplo')).toBeTruthy();
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Sair' })).toBeTruthy();
    expect(hrefsDoPainel()).toEqual([
      '/painel/agenda',
      '/painel/clientes',
      '/painel/servicos',
      '/painel/profissionais',
      '/painel/bloqueios',
      '/painel/configuracoes',
      '/painel/assinatura',
    ]);
    expect(screen.queryByRole('contentinfo')).toBeNull();
  });

  it('CA-11: profissional não tem links das áreas do gestor', () => {
    render(
      <PanelLayout papel="profissional" nomeSalao="S">
        x
      </PanelLayout>,
    );
    expect(hrefsDoPainel()).toEqual(['/painel/agenda', '/painel/bloqueios']);
    for (const proibido of [
      '/painel/clientes',
      '/painel/servicos',
      '/painel/profissionais',
      '/painel/configuracoes',
      '/painel/assinatura',
    ]) {
      expect(document.querySelector(`a[href="${proibido}"]`)).toBeNull();
    }
  });

  it.each(['super_admin', 'toString', undefined, 'x'])('CA-11: papel inválido %s → nenhum item, sem lançar', (papel) => {
    render(
      <PanelLayout papel={papel as never} nomeSalao="S">
        x
      </PanelLayout>,
    );
    expect(screen.queryByRole('navigation', { hidden: true })).toBeNull();
    expect(document.querySelectorAll('a[href^="/painel"]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('caminhoAtual marca só o item ativo (prefixo por segmento)', () => {
    render(
      <PanelLayout papel="gestor" nomeSalao="S" caminhoAtual="/painel/agenda/nova">
        x
      </PanelLayout>,
    );
    const atuais = document.querySelectorAll('[aria-current="page"]');
    expect(atuais).toHaveLength(1);
    expect(atuais[0].getAttribute('href')).toBe('/painel/agenda');
  });
});

describe('AdminLayout (CA-17, RN-12, RN-16)', () => {
  it('rótulo da área, 3 itens e navegação própria', () => {
    const { container } = render(<AdminLayout caminhoAtual="/admin/mensagens">x</AdminLayout>);
    conferirEstrutura(container);
    expect(within(screen.getByRole('banner')).getByText('Administração da plataforma')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Navegação da administração', hidden: true });
    expect(within(nav).getAllByRole('link', { hidden: true }).map((a) => a.textContent)).toEqual([
      'Salões',
      'Mensagens',
      'Auditoria',
    ]);
    expect(document.querySelector('[aria-current="page"]')!.getAttribute('href')).toBe('/admin/mensagens');
  });

  it('rótulo da área e área do usuário configuráveis', () => {
    render(
      <AdminLayout rotuloArea="Plataforma" areaUsuario={<span>Admin</span>}>
        x
      </AdminLayout>,
    );
    expect(within(screen.getByRole('banner')).getByText('Plataforma')).toBeTruthy();
    expect(within(screen.getByRole('banner')).getByText('Admin')).toBeTruthy();
    expect(document.querySelector('[aria-current]')).toBeNull();
  });

  it('semNavegacao omite o menu (D-034: /admin não aponta para telas inexistentes)', () => {
    render(<AdminLayout semNavegacao>x</AdminLayout>);
    expect(screen.queryByRole('navigation', { name: 'Navegação da administração', hidden: true })).toBeNull();
    expect(screen.queryAllByRole('link', { hidden: true }).map((a) => a.getAttribute('href'))).not.toContain('/admin/saloes');
  });
});
