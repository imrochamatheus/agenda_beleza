/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGEM_LINK_INVALIDO, MENSAGENS_AVALIACAO } from '@/server/avaliacoes/tipos';
import type { DadosDoWidget } from '@/server/protecao/widget-tipos';

import type { AcaoAvaliar, EstadoAvaliacao } from './estado';
import { FormularioAvaliacao } from './FormularioAvaliacao';

const HUMANO: DadosDoWidget = { modo: 'simulado', chaveDoSite: '', tokenSimulado: 'ok', controleDeTeste: false };
const estado = (e: Partial<EstadoAvaliacao>): EstadoAvaliacao => ({
  status: 'editando', mensagem: null, erros: {}, valores: { nota: '', comentario: '', aceite: false }, ...e,
});

function montar(acao: AcaoAvaliar, verificacao: 'valido' | 'invalido' | 'limitado' = 'valido') {
  return render(<FormularioAvaliacao acao={acao} slug="meu-salao" token="TOKEN123" nomeSalao="Salão da Ana" verificacao={verificacao} humano={HUMANO} />);
}

describe('FormularioAvaliacao', () => {
  it('link válido: título, cinco notas, comentário, aceite com links e botão; token e slug só ocultos', () => {
    const { container } = montar(vi.fn());
    expect(screen.getByRole('heading', { level: 1, name: 'Avalie Salão da Ana' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['1', '2', '3', '4', '5']);
    expect(screen.getByRole('group', { name: /Nota de 1 a 5/ })).toBeTruthy();
    expect(screen.getByLabelText(/Comentário/)).toBeTruthy();
    const aceite = screen.getByRole('checkbox', { name: /Autorizo a publicação da minha avaliação/ }) as HTMLInputElement;
    expect(aceite.name).toBe('aceite_publicacao');
    expect(aceite.required).toBe(true);
    expect(screen.getByRole('link', { name: /Política de Privacidade/ }).getAttribute('href')).toBe('/privacidade');
    expect(screen.getByRole('button', { name: 'Enviar avaliação' })).toBeTruthy();
    expect((container.querySelector('input[name="token"]') as HTMLInputElement).value).toBe('TOKEN123');
    expect((container.querySelector('input[name="slug"]') as HTMLInputElement).value).toBe('meu-salao');
    expect(container.textContent).not.toContain('TOKEN123');
  });

  it.each([['invalido', MENSAGEM_LINK_INVALIDO], ['limitado', MENSAGENS_AVALIACAO.limitado]] as const)(
    'veredito %s: sem formulário e sem token',
    (v, texto) => {
      const { container } = montar(vi.fn(), v);
      expect(screen.getByRole('alert').textContent).toContain(texto);
      expect(screen.queryByRole('button')).toBeNull();
      expect(container.querySelector('input[name="token"]')).toBeNull();
    },
  );

  it('envia o formulário, mostra "Avaliação enviada" com link para o salão', async () => {
    const acao: AcaoAvaliar = vi.fn(async () => estado({ status: 'enviada', mensagem: MENSAGENS_AVALIACAO.enviada }));
    montar(acao);
    fireEvent.click(screen.getByRole('radio', { name: '5' }));
    fireEvent.change(screen.getByLabelText(/Comentário/), { target: { value: 'Adorei' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Avaliação enviada' })).toBeTruthy());
    const dados = (acao as ReturnType<typeof vi.fn>).mock.calls[0][1] as FormData;
    expect(dados.get('nota')).toBe('5');
    expect(dados.get('comentario')).toBe('Adorei');
    expect(dados.get('aceite_publicacao')).toBe('on');
    expect(dados.get('token')).toBe('TOKEN123');
    expect(screen.getByRole('link', { name: 'Ver a página do salão' }).getAttribute('href')).toBe('/meu-salao');
  });

  it('erros por campo ficam associados e os valores digitados são preservados', async () => {
    const acao: AcaoAvaliar = vi.fn(async () =>
      estado({
        erros: { nota: MENSAGENS_AVALIACAO.nota, comentario: MENSAGENS_AVALIACAO.comentario, aceite: MENSAGENS_AVALIACAO.aceite },
        valores: { nota: '3', comentario: 'meu texto', aceite: false },
      }),
    );
    montar(acao);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));
    await waitFor(() => expect(screen.getByText(MENSAGENS_AVALIACAO.nota)).toBeTruthy());
    expect((screen.getByLabelText(/Comentário/) as HTMLTextAreaElement).value).toBe('meu texto');
    expect((screen.getByRole('radio', { name: '3' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText(/Comentário/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/Comentário/).getAttribute('aria-describedby')).toContain('avaliar-comentario-erro');
    expect(screen.getByRole('group').getAttribute('aria-describedby')).toBe('avaliar-nota-erro');
    expect(screen.getByRole('checkbox').getAttribute('aria-invalid')).toBe('true');
  });

  it('mensagem geral (verificação humana) aparece como alerta e o formulário continua', async () => {
    const acao: AcaoAvaliar = vi.fn(async () => estado({ mensagem: MENSAGENS_AVALIACAO.humano }));
    montar(acao);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(MENSAGENS_AVALIACAO.humano));
    expect(screen.getByRole('button', { name: 'Enviar avaliação' })).toBeTruthy();
  });

  it('ação devolve link inválido: troca para a tela de recusa uniforme', async () => {
    const acao: AcaoAvaliar = vi.fn(async () => estado({ status: 'invalido', mensagem: MENSAGEM_LINK_INVALIDO }));
    montar(acao);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Link inválido' })).toBeTruthy());
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
