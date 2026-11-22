/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssinaturaDoSalaoDTO } from '@/server/admin/assinatura-tipos';

import { TelaDeAssinatura } from './TelaDeAssinatura';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/saloes/s1/assinatura' }));
afterEach(cleanup);

const base: AssinaturaDoSalaoDTO = {
  salao: { id: 's1', nome: 'Studio Aurora', fuso: 'America/Manaus' },
  assinatura: { estado: 'em_carencia', vinculada: true, testeFimEm: null, periodoPagoAte: '2026-11-20T14:00:00.000Z', primeiraFalhaEm: null, carenciaAte: '2026-11-24T14:00:00.000Z', canceladaEm: null, acessoAte: null },
  transicoes: [{ id: 't1', de: null, para: 'em_teste', causa: 'criada', ocorridaEm: '2026-11-20T14:00:00.000Z', origemEvento: true }],
  eventos: [
    { id: 'e1', tipo: 'payment', resultado: 'rejeitado', origemValida: false, erro: 'vinculo_invalido', recebidoEm: '2026-11-21T14:00:00.000Z', processadoEm: null, payload: { id: 'x' } },
    { id: 'e2', tipo: null, resultado: 'processado', origemValida: true, erro: null, recebidoEm: '2026-11-21T15:00:00.000Z', processadoEm: '2026-11-21T15:00:02.000Z', payload: null },
  ],
  maisEventos: true,
};
const tela = (d: AssinaturaDoSalaoDTO) => render(<TelaDeAssinatura dados={d} hrefSalao="/admin/saloes/s1" hrefAuditoria="/admin/auditoria?salao=s1" />);

describe('TelaDeAssinatura (D-045 CA-1, CA-13)', () => {
  it('resumo no fuso do salão (nulos omitidos, sem id do provedor), transições e eventos com rejeitado em texto', () => {
    tela(base);
    expect(screen.getByRole('heading', { level: 1, name: 'Assinatura de Studio Aurora' })).toBeTruthy();
    expect(screen.getByText(/Horários no fuso do salão \(America\/Manaus, UTC−04:00\)\./)).toBeTruthy();
    expect(screen.getByText('Vinculada ao Mercado Pago')).toBeTruthy();
    expect(screen.getAllByText('20/11/2026 10:00').length).toBeGreaterThan(0);
    expect(screen.queryByText('Fim do teste')).toBeNull();
    expect(screen.queryByText('Cancelada em')).toBeNull();
    expect(screen.getByText('— → Em período de teste')).toBeTruthy();
    expect(screen.getByText('Origem: evento')).toBeTruthy();
    const eventos = screen.getByRole('table', { name: 'Eventos recebidos' });
    expect(within(eventos).getByText('Rejeitado')).toBeTruthy();
    expect(within(eventos).getByText('Origem inválida')).toBeTruthy();
    expect(within(eventos).getByText('erro: vinculo_invalido')).toBeTruthy();
    expect(within(eventos).getByText('Tipo: —')).toBeTruthy();
    expect(screen.getByText('Mostrando os 50 mais recentes')).toBeTruthy();
    expect(screen.getAllByText('Ver payload')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Auditoria deste salão' }).getAttribute('href')).toBe('/admin/auditoria?salao=s1');
  });

  it('sem assinatura: só o estado vazio', () => {
    tela({ ...base, assinatura: null, transicoes: [], eventos: [], maisEventos: false });
    expect(screen.getByRole('heading', { name: 'Este salão ainda não tem assinatura' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Transições' })).toBeNull();
  });

  it('sem transições nem eventos: mensagens vazias', () => {
    tela({ ...base, transicoes: [], eventos: [], maisEventos: false });
    expect(screen.getByRole('heading', { name: 'Nenhuma transição registrada' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nenhum evento de webhook recebido' })).toBeTruthy();
    expect(screen.queryByText('Mostrando os 50 mais recentes')).toBeNull();
  });
});
