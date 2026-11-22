/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ListaMensagens, MensagemAdminDTO } from '@/server/admin/mensagens-tipos';

import { TelaDeMensagens } from './TelaDeMensagens';
import type { TelaDeMensagensProps } from './TelaDeMensagens';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/mensagens' }));
afterEach(cleanup);

const msg = (o: Partial<MensagemAdminDTO> = {}): MensagemAdminDTO => ({
  id: 'id-1',
  salaoId: 's-1',
  salaoNome: 'Studio Aurora',
  tipo: 'confirmacao',
  revisao: 0,
  estado: 'enviada',
  erroCodigo: null,
  paraMascarado: '+55 (71) 9****-1234',
  criadaEm: '2026-11-21T17:05:00.000Z',
  atualizadaEm: '2026-11-21T17:05:00.000Z',
  enviadaEm: '2026-11-21T17:05:20.000Z',
  ...o,
});
const lista = (itens: MensagemAdminDTO[], o: Partial<ListaMensagens> = {}): ListaMensagens => ({
  itens,
  total: itens.length,
  pagina: 1,
  paginas: 1,
  filtros: { estado: null, tipo: null, salaoId: null, pagina: 1 },
  ignorados: false,
  salao: { modo: 'select', opcoes: [{ id: 's-1', nome: 'Studio Aurora' }] },
  ...o,
});
const acao = async () => {};
function tela(p: Partial<TelaDeMensagensProps> = {}) {
  return render(<TelaDeMensagens lista={lista([msg()])} base="/admin/mensagens" hrefDoSalao={(id) => `/admin/saloes/${id}`} reenvio={null} confirmacao={null} detalhe={null} acaoReenviar={acao} {...p} />);
}

describe('TelaDeMensagens (D-045)', () => {
  it('lista: tabela nomeada, selo, telefone mascarado, salão com link, datas em São Paulo, resumo aria-live', () => {
    tela({ lista: lista([msg(), msg({ id: 'id-2', estado: 'falhou', erroCodigo: 'resultado_incerto', tipo: 'remarcacao', revisao: 2, enviadaEm: null })]) });
    expect(screen.getByRole('table', { name: 'Fila de mensagens' })).toBeTruthy();
    expect(screen.getByText('Remarcação 2')).toBeTruthy();
    expect(screen.getAllByText('Para: +55 (71) 9****-1234').length).toBe(2);
    expect(screen.getAllByRole('link', { name: 'Studio Aurora' })[0].getAttribute('href')).toBe('/admin/saloes/s-1');
    expect(screen.getAllByText('Criada em 21/11/2026 14:05 (UTC−03:00)').length).toBe(2);
    expect(screen.getByText('Enviada em 21/11/2026 14:05 (UTC−03:00)')).toBeTruthy();
    expect(screen.getByText('código: resultado_incerto')).toBeTruthy();
    expect(screen.getByText('2 de 2 mensagens').getAttribute('aria-live')).toBe('polite');
  });

  it('"Reenviar" só na linha falhou, com href ?confirmar=<id>#confirmar; "Tentativas" em todas', () => {
    tela({ lista: lista([msg(), msg({ id: 'id-2', estado: 'falhou' })]) });
    const reenviar = screen.getAllByRole('link', { name: 'Reenviar' });
    expect(reenviar).toHaveLength(1);
    expect(reenviar[0].getAttribute('href')).toBe('/admin/mensagens?confirmar=id-2#confirmar');
    expect(screen.getAllByRole('link', { name: 'Tentativas' })).toHaveLength(2);
  });

  it('filtros: três campos, estado do filtro no resumo e "Limpar filtros"; cliente removida em itálico', () => {
    tela({ lista: lista([msg({ paraMascarado: 'Cliente removida', estado: 'cancelada_anonimizacao' })], { filtros: { estado: 'falhou', tipo: 'cancelamento', salaoId: 's-1', pagina: 1 } }) });
    expect(screen.getByRole('combobox', { name: 'Situação' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Tipo' })).toBeTruthy();
    expect(screen.getByText('1 de 1 mensagem · Situação: Falhou · Tipo: Cancelamento · Salão: Studio Aurora')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Limpar filtros' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Cliente removida').className).toContain('removida');
  });

  it('confirmação: tipo, salão, telefone mascarado, aviso, POST com id e filtros; Cancelar preserva os filtros', () => {
    const { container } = tela({
      lista: lista([], { filtros: { estado: 'falhou', tipo: null, salaoId: 's-1', pagina: 2 } }),
      confirmacao: { mensagem: msg({ id: 'id-9', estado: 'falhou' }) },
    });
    const bloco = document.getElementById('confirmar')!;
    expect(within(bloco).getByRole('heading', { level: 2, name: 'Reenviar esta mensagem?' })).toBeTruthy();
    expect(within(bloco).getByText('+55 (71) 9****-1234')).toBeTruthy();
    expect(within(bloco).getByText(/Será enviada uma nova mensagem por WhatsApp/)).toBeTruthy();
    expect(within(bloco).getByRole('button', { name: 'Confirmar reenvio' }).getAttribute('type')).toBe('submit');
    const hidden = Array.from(container.querySelectorAll('#confirmar input[type="hidden"]')).map((i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]);
    expect(hidden).toEqual([['mensagemId', 'id-9'], ['estado', 'falhou'], ['salao', 's-1'], ['pagina', '2']]);
    expect(within(bloco).getByRole('link', { name: 'Cancelar' }).getAttribute('href')).toBe('/admin/mensagens?estado=falhou&salao=s-1&pagina=2');
    expect(JSON.stringify(container.innerHTML)).not.toMatch(/\+55\d{10}/);
  });

  it('confirmação indisponível: aviso e nenhum botão', () => {
    tela({ confirmacao: { indisponivel: true } });
    expect(screen.getByText('Esta mensagem não está mais com falha.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirmar reenvio' })).toBeNull();
  });

  it('resultado do PRG: alerta com o texto fechado; filtro inválido', () => {
    tela({ reenvio: 'obsoleta', lista: lista([msg()], { ignorados: true }) });
    expect(screen.getByText('Nada foi reenviado: a reserva mudou e a mensagem perdeu a validade.')).toBeTruthy();
    expect(screen.getByText('Filtro inválido ignorado.')).toBeTruthy();
  });

  it('tentativas: tabela com resultado em texto e vazio', () => {
    const t = { numero: 1, iniciadaEm: '2026-11-21T17:00:00.000Z', finalizadaEm: '2026-11-21T17:00:04.000Z', resultado: 'falha' as const, erroCodigo: 'timeout' };
    tela({ detalhe: { mensagem: msg(), tentativas: [t, { ...t, numero: 2, resultado: 'sucesso', erroCodigo: null }, { ...t, numero: 3, resultado: null, finalizadaEm: null }] } });
    const tabela = screen.getByRole('table', { name: 'Tentativas' });
    expect(within(tabela).getByText('Falha')).toBeTruthy();
    expect(within(tabela).getByText('Sucesso')).toBeTruthy();
    expect(within(tabela).getByText('Em andamento')).toBeTruthy();
    expect(within(tabela).getAllByText('timeout')).toHaveLength(2);
    cleanup();
    tela({ detalhe: { mensagem: msg(), tentativas: [] } });
    expect(screen.getByRole('heading', { name: 'Nenhuma tentativa registrada' })).toBeTruthy();
  });

  it('vazios: fila vazia, filtro sem resultado e página além do fim', () => {
    tela({ lista: lista([], { total: 0 }) });
    expect(screen.getByRole('heading', { name: 'A fila está vazia.' })).toBeTruthy();
    cleanup();
    tela({ lista: lista([], { total: 0, filtros: { estado: 'falhou', tipo: null, salaoId: null, pagina: 1 } }) });
    expect(screen.getByRole('heading', { name: 'Nenhuma mensagem encontrada' })).toBeTruthy();
    cleanup();
    tela({ lista: lista([], { total: 40, pagina: 9, paginas: 2, filtros: { estado: null, tipo: null, salaoId: null, pagina: 9 } }) });
    expect(screen.getByRole('link', { name: 'Ir para a primeira página' }).getAttribute('href')).toBe('/admin/mensagens');
  });
});
