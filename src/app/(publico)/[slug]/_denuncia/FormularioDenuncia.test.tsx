/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGENS_DENUNCIA } from '@/server/denuncias/tipos';
import type { DadosDoWidget } from '@/server/protecao/widget-tipos';

import type { AcaoDenunciar, EstadoDenuncia } from './estado';
import { FormularioDenuncia } from './FormularioDenuncia';

const HUMANO: DadosDoWidget = { modo: 'simulado', chaveDoSite: '', tokenSimulado: 'ok', controleDeTeste: false };
const estado = (e: Partial<EstadoDenuncia>): EstadoDenuncia => ({ status: 'invalido', mensagem: null, erros: {}, valores: { motivo: '', texto: '' }, ...e });

function montar(acao: AcaoDenunciar) {
  return render(<FormularioDenuncia acao={acao} slug="meu-salao" avaliacaoId="id-1" nome="Maria S." humano={HUMANO} />);
}

describe('FormularioDenuncia', () => {
  it('details fechado com resumo rotulado; dentro, cinco motivos, detalhes, campos ocultos e botão', () => {
    const { container } = montar(vi.fn());
    const detalhes = container.querySelector('details') as HTMLDetailsElement;
    expect(detalhes.open).toBe(false);
    expect(screen.getByText('Denunciar avaliação').getAttribute('aria-label')).toBe('Denunciar avaliação de Maria S.');
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['ofensivo', 'falso', 'spam', 'dados_pessoais', 'outro']);
    expect(screen.getByRole('group', { name: /Motivo/ })).toBeTruthy();
    expect(screen.getByLabelText(/Detalhes/)).toBeTruthy();
    expect((container.querySelector('input[name="slug"]') as HTMLInputElement).value).toBe('meu-salao');
    expect((container.querySelector('input[name="avaliacao_id"]') as HTMLInputElement).value).toBe('id-1');
    expect((container.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement).value).toBe('ok');
    expect(screen.getByRole('button', { name: 'Enviar denúncia' })).toBeTruthy();
  });

  it('envia o formulário; erro de campo abre o details e liga o erro ao campo', async () => {
    const acao: AcaoDenunciar = vi.fn(async () => estado({ erros: { motivo: MENSAGENS_DENUNCIA.motivo, texto: MENSAGENS_DENUNCIA.texto }, valores: { motivo: '', texto: 'meu texto' } }));
    const { container } = montar(acao);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }));
    await waitFor(() => expect(screen.getByText(MENSAGENS_DENUNCIA.motivo)).toBeTruthy());
    expect(acao).toHaveBeenCalledTimes(1);
    expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(true);
    const texto = screen.getByLabelText(/Detalhes/) as HTMLTextAreaElement;
    expect(texto.value).toBe('meu texto');
    expect(texto.getAttribute('aria-invalid')).toBe('true');
    expect(texto.getAttribute('aria-describedby')).toContain('denuncia-id-1-texto-erro');
    expect(screen.getByRole('group', { name: /Motivo/ }).getAttribute('aria-describedby')).toBe('denuncia-id-1-motivo-erro');
  });

  it.each([['humano', MENSAGENS_DENUNCIA.humano], ['limitado', MENSAGENS_DENUNCIA.limitado]] as const)('estado %s mostra o alerta', async (status, msg) => {
    montar(vi.fn(async () => estado({ status, mensagem: msg })));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(msg));
  });
});
