/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ListaAuditoria, RegistroAuditoriaDTO } from '@/server/admin/auditoria-tipos';

import { TelaDeAuditoria } from './TelaDeAuditoria';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/auditoria' }));
afterEach(cleanup);

const reg = (o: Partial<RegistroAuditoriaDTO> = {}): RegistroAuditoriaDTO => ({
  id: 'r1',
  acao: 'mensagem.reenviar',
  entidade: 'mensagem',
  resultado: 'sucesso',
  ocorridoEm: '2026-11-22T12:12:00.000Z',
  atorEmail: 'admin@plataforma.com.br',
  salaoId: 's1',
  salaoNome: 'Studio Aurora',
  antes: { estado: 'falhou' },
  depois: { estado: 'pendente' },
  ...o,
});
const lista = (itens: RegistroAuditoriaDTO[], o: Partial<ListaAuditoria> = {}): ListaAuditoria => ({
  itens,
  total: itens.length,
  pagina: 1,
  paginas: 1,
  filtros: { salaoId: null, ator: null, acao: null, resultado: null, de: null, ate: null, pagina: 1 },
  erros: {},
  ignorados: false,
  ecoes: { ator: '', de: '', ate: '' },
  salao: { modo: 'select', opcoes: [{ id: 's1', nome: 'Studio Aurora' }] },
  ...o,
});
const tela = (l: ListaAuditoria) => render(<TelaDeAuditoria lista={l} base="/admin/auditoria" hrefDoSalao={(id) => `/admin/saloes/${id}`} />);

describe('TelaDeAuditoria (D-045)', () => {
  it('linha: data em São Paulo, rótulo e código da ação, ator, salão com link, selo e antes/depois', () => {
    tela(lista([reg(), reg({ id: 'r2', acao: 'login.sucesso', entidade: 'usuario', atorEmail: null, salaoId: null, salaoNome: null, antes: null, depois: null }), reg({ id: 'r3', resultado: 'falha', acao: 'login.falha_senha' })]));
    expect(screen.getByRole('table', { name: 'Registros de auditoria' })).toBeTruthy();
    expect(screen.getAllByText('22/11/2026 09:12 (UTC−03:00)').length).toBe(3);
    expect(screen.getAllByText('Mensagem reenviada').length).toBeGreaterThan(0);
    expect(screen.getAllByText('mensagem.reenviar').length).toBeGreaterThan(0);
    expect(screen.getByText('Sistema')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Studio Aurora' })[0].getAttribute('href')).toBe('/admin/saloes/s1');
    expect(within(screen.getByRole('table')).getByText('Falha')).toBeTruthy();
    expect(within(screen.getByRole('table')).getAllByText('Sucesso').length).toBe(2);
    expect(screen.getAllByText(/^Ver alterações/).length).toBe(2);
    expect(screen.getByText('Somente leitura.', { exact: false })).toBeTruthy();
  });

  it('filtros: campos, erros de campo, resumo dos filtros e Limpar filtros', () => {
    tela(
      lista([], {
        total: 0,
        filtros: { salaoId: 's1', ator: 'a@b.com', acao: 'salao.suspender', resultado: 'falha', de: '2026-11-01', ate: '2026-11-30', pagina: 1 },
        erros: { de: 'A data inicial é depois da final.', ator: 'Informe um e-mail válido.' },
        ecoes: { ator: 'a@b.com', de: '2026-11-01', ate: '2026-11-30' },
        ignorados: true,
      }),
    );
    expect(screen.getByRole('search', { name: 'Filtrar registros de auditoria' })).toBeTruthy();
    expect((screen.getByLabelText('De') as HTMLInputElement).type).toBe('date');
    expect((screen.getByLabelText('De') as HTMLInputElement).value).toBe('2026-11-01');
    expect(screen.getByText('A data inicial é depois da final.')).toBeTruthy();
    expect(screen.getByText('Informe um e-mail válido.')).toBeTruthy();
    expect(screen.getByText('Filtro inválido ignorado.')).toBeTruthy();
    expect(screen.getByText('0 de 0 registros · Ação: Salão suspenso · Resultado: Falha · Ator: a@b.com · Salão: Studio Aurora · De 01/11/2026 · Até 30/11/2026')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nenhum registro encontrado' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Limpar filtros' }).length).toBe(2);
  });

  it('salão em modo código (sem nome) e página além do fim', () => {
    tela(lista([], { total: 30, pagina: 8, paginas: 2, salao: { modo: 'codigo' }, filtros: { salaoId: 'xyz', ator: null, acao: null, resultado: null, de: null, ate: null, pagina: 8 } }));
    expect(screen.getByRole('textbox', { name: 'Código do salão' })).toBeTruthy();
    expect(screen.getByText('0 de 30 registros · Salão: xyz')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir para a primeira página' }).getAttribute('href')).toBe('/admin/auditoria?salao=xyz');
  });
});
